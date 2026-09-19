import { createHash } from "node:crypto";

import type { ResponseMode } from "./hybrid-routing.js";

export type HybridProviderName = "nine-router" | "hermes";

export interface NineRouterSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  groundedModel: string;
  deepModel: string;
  timeoutMs: number;
}

export interface HermesSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  ownerActionsEnabled: boolean;
}

export interface HybridAgentSettings {
  enabled: boolean;
  allowRemoteEndpoints: boolean;
  maxConcurrentHeavy: number;
  failureThreshold: number;
  circuitCooldownMs: number;
  maxResponseBytes: number;
  nineRouter: NineRouterSettings;
  hermes: HermesSettings;
}

export interface HybridAnswerRequest {
  mode: ResponseMode;
  systemPrompt: string;
  userPrompt: string;
  fallback: () => Promise<string>;
  sessionKey?: string;
  isOwner?: boolean;
  explicitToolRequest?: boolean;
  hasMedia?: boolean;
}

export interface HybridTelemetryEvent {
  provider: HybridProviderName;
  mode: ResponseMode;
  outcome:
    | "success"
    | "circuit_open"
    | "invalid_endpoint"
    | "timeout"
    | "http_error"
    | "invalid_response"
    | "network_error";
  latencyMs: number;
  status?: number;
}

export interface HybridAgentDependencies {
  fetchFn?: typeof fetch;
  now?: () => number;
  logger?: (event: HybridTelemetryEvent) => void;
}

interface ProviderCandidate {
  provider: HybridProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  allowTools: boolean;
  sessionId?: string;
}

interface CircuitState {
  failures: number;
  openUntil: number;
}

class ProviderRequestError extends Error {
  constructor(
    readonly outcome: HybridTelemetryEvent["outcome"],
    readonly status?: number,
  ) {
    super(outcome);
  }
}

class AsyncSemaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }

    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export function createDefaultHybridAgentSettings(): HybridAgentSettings {
  return {
    enabled: false,
    allowRemoteEndpoints: false,
    maxConcurrentHeavy: 1,
    failureThreshold: 2,
    circuitCooldownMs: 60_000,
    maxResponseBytes: 256 * 1024,
    nineRouter: {
      enabled: false,
      baseUrl: "http://127.0.0.1:20128/v1",
      apiKey: "",
      groundedModel: "",
      deepModel: "",
      timeoutMs: 45_000,
    },
    hermes: {
      enabled: false,
      baseUrl: "http://127.0.0.1:8642/v1",
      apiKey: "",
      model: "hermes-agent",
      timeoutMs: 90_000,
      ownerActionsEnabled: false,
    },
  };
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]";
}

export function validateProviderBaseUrl(baseUrl: string, allowRemoteEndpoints: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ProviderRequestError("invalid_endpoint");
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ProviderRequestError("invalid_endpoint");
  }

  const isLoopback = isLoopbackHostname(parsed.hostname);
  if (isLoopback && (parsed.protocol === "http:" || parsed.protocol === "https:")) return parsed;
  if (allowRemoteEndpoints && parsed.protocol === "https:") return parsed;
  throw new ProviderRequestError("invalid_endpoint");
}

function completionUrl(baseUrl: URL): string {
  const normalized = baseUrl.toString().replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function hashSessionId(rawSessionKey: string): string {
  const digest = createHash("sha256").update(rawSessionKey, "utf8").digest("hex").slice(0, 32);
  return `zalo-${digest}`;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new ProviderRequestError("invalid_response", response.status);

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ProviderRequestError("invalid_response", response.status);
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function extractCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("")
      .trim();
  }
  return "";
}

function defaultLogger(event: HybridTelemetryEvent): void {
  const status = typeof event.status === "number" ? ` status=${event.status}` : "";
  console.info(
    `[hybrid-agent] provider=${event.provider} mode=${event.mode} outcome=${event.outcome}` +
    ` latencyMs=${event.latencyMs}${status}`,
  );
}

export class HybridAgentRuntime {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly logger: (event: HybridTelemetryEvent) => void;
  private readonly semaphore: AsyncSemaphore;
  private readonly circuits = new Map<HybridProviderName, CircuitState>();

  constructor(
    private readonly settings: HybridAgentSettings,
    dependencies: HybridAgentDependencies = {},
  ) {
    this.fetchFn = dependencies.fetchFn || fetch;
    this.now = dependencies.now || Date.now;
    this.logger = dependencies.logger || defaultLogger;
    this.semaphore = new AsyncSemaphore(clampInteger(settings.maxConcurrentHeavy, 1, 8));
  }

  async answer(request: HybridAnswerRequest): Promise<string> {
    if (!this.settings.enabled || request.mode === "fast" || request.hasMedia) {
      return await request.fallback();
    }

    const candidates = this.buildCandidates(request);
    for (const candidate of candidates) {
      const answer = await this.tryCandidate(candidate, request);
      if (answer) return answer;
    }

    return await request.fallback();
  }

  private buildCandidates(request: HybridAnswerRequest): ProviderCandidate[] {
    const candidates: ProviderCandidate[] = [];
    const router = this.settings.nineRouter;
    const hermes = this.settings.hermes;

    if (request.mode === "grounded") {
      if (router.enabled && router.apiKey && router.groundedModel) {
        candidates.push({
          provider: "nine-router",
          baseUrl: router.baseUrl,
          apiKey: router.apiKey,
          model: router.groundedModel,
          timeoutMs: router.timeoutMs,
          allowTools: false,
        });
      }
      return candidates;
    }

    if (request.mode === "deep") {
      if (hermes.enabled && hermes.apiKey && hermes.model && request.sessionKey) {
        candidates.push({
          provider: "hermes",
          baseUrl: hermes.baseUrl,
          apiKey: hermes.apiKey,
          model: hermes.model,
          timeoutMs: hermes.timeoutMs,
          allowTools: false,
          sessionId: hashSessionId(request.sessionKey),
        });
      }
      if (router.enabled && router.apiKey && router.deepModel) {
        candidates.push({
          provider: "nine-router",
          baseUrl: router.baseUrl,
          apiKey: router.apiKey,
          model: router.deepModel,
          timeoutMs: router.timeoutMs,
          allowTools: false,
        });
      }
      return candidates;
    }

    if (
      request.mode === "action" &&
      request.isOwner === true &&
      request.explicitToolRequest === true &&
      hermes.ownerActionsEnabled &&
      hermes.enabled &&
      hermes.apiKey &&
      hermes.model &&
      request.sessionKey
    ) {
      candidates.push({
        provider: "hermes",
        baseUrl: hermes.baseUrl,
        apiKey: hermes.apiKey,
        model: hermes.model,
        timeoutMs: hermes.timeoutMs,
        allowTools: true,
        sessionId: hashSessionId(request.sessionKey),
      });
    }
    return candidates;
  }

  private async tryCandidate(
    candidate: ProviderCandidate,
    request: HybridAnswerRequest,
  ): Promise<string | null> {
    const circuit = this.circuits.get(candidate.provider);
    if (circuit && circuit.openUntil > this.now()) {
      this.log(candidate.provider, request.mode, "circuit_open", 0);
      return null;
    }

    let endpoint: URL;
    try {
      endpoint = validateProviderBaseUrl(candidate.baseUrl, this.settings.allowRemoteEndpoints);
    } catch {
      this.recordFailure(candidate.provider);
      this.log(candidate.provider, request.mode, "invalid_endpoint", 0);
      return null;
    }

    return await this.semaphore.run(async () => {
      const refreshedCircuit = this.circuits.get(candidate.provider);
      if (refreshedCircuit && refreshedCircuit.openUntil > this.now()) {
        this.log(candidate.provider, request.mode, "circuit_open", 0);
        return null;
      }

      const startedAt = this.now();
      try {
        const answer = await this.callProvider(candidate, endpoint, request);
        this.recordSuccess(candidate.provider);
        this.log(candidate.provider, request.mode, "success", this.now() - startedAt);
        return answer;
      } catch (error) {
        const failure = error instanceof ProviderRequestError
          ? error
          : new ProviderRequestError("network_error");
        this.recordFailure(candidate.provider);
        this.log(
          candidate.provider,
          request.mode,
          failure.outcome,
          this.now() - startedAt,
          failure.status,
        );
        return null;
      }
    });
  }

  private async callProvider(
    candidate: ProviderCandidate,
    endpoint: URL,
    request: HybridAnswerRequest,
  ): Promise<string> {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = clampInteger(candidate.timeoutMs, 1, 300_000);
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchFn(completionUrl(endpoint), {
          method: "POST",
          headers: {
            authorization: `Bearer ${candidate.apiKey}`,
            "content-type": "application/json",
            ...(candidate.sessionId ? { "x-session-id": candidate.sessionId } : {}),
          },
          body: JSON.stringify({
            model: candidate.model,
            stream: false,
            max_tokens: 4096,
            tool_choice: candidate.allowTools ? "auto" : "none",
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt },
            ],
          }),
          signal: controller.signal,
        });
      } catch {
        throw new ProviderRequestError(timedOut ? "timeout" : "network_error");
      }

      if (!response.ok) throw new ProviderRequestError("http_error", response.status);
      const text = await readBoundedText(
        response,
        clampInteger(this.settings.maxResponseBytes, 4_096, 1024 * 1024),
      );
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new ProviderRequestError("invalid_response", response.status);
      }
      const answer = extractCompletionText(payload);
      if (!answer) throw new ProviderRequestError("invalid_response", response.status);
      return answer;
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordSuccess(provider: HybridProviderName): void {
    this.circuits.set(provider, { failures: 0, openUntil: 0 });
  }

  private recordFailure(provider: HybridProviderName): void {
    const previous = this.circuits.get(provider) || { failures: 0, openUntil: 0 };
    const failures = previous.failures + 1;
    const threshold = clampInteger(this.settings.failureThreshold, 1, 20);
    this.circuits.set(provider, {
      failures,
      openUntil: failures >= threshold
        ? this.now() + clampInteger(this.settings.circuitCooldownMs, 1_000, 3_600_000)
        : 0,
    });
  }

  private log(
    provider: HybridProviderName,
    mode: ResponseMode,
    outcome: HybridTelemetryEvent["outcome"],
    latencyMs: number,
    status?: number,
  ): void {
    this.logger({
      provider,
      mode,
      outcome,
      latencyMs: Math.max(0, Math.trunc(latencyMs)),
      ...(typeof status === "number" ? { status } : {}),
    });
  }
}

let sharedRuntime: HybridAgentRuntime | null = null;

export function answerWithHybridRouting(
  settings: HybridAgentSettings,
  request: HybridAnswerRequest,
): Promise<string> {
  sharedRuntime ||= new HybridAgentRuntime(settings);
  return sharedRuntime.answer(request);
}
