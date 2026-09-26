export const RESPONSE_MODES = ["fast", "grounded", "deep", "action"] as const;
export const TASK_COMPLEXITIES = ["low", "medium", "high"] as const;
export const TOOL_INTENTS = ["none", "read", "create", "execute"] as const;
export const RISK_LEVELS = ["normal", "high"] as const;

export type ResponseMode = (typeof RESPONSE_MODES)[number];
export type TaskComplexity = (typeof TASK_COMPLEXITIES)[number];
export type ToolIntent = (typeof TOOL_INTENTS)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface ExecutionSignals {
  responseMode: ResponseMode;
  complexity: TaskComplexity;
  toolIntent: ToolIntent;
  riskLevel: RiskLevel;
}

export interface ExecutionSignalInput {
  question: string;
  quoteText?: string;
  needsSearch: boolean;
  intent: string;
}

function normalizeText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function detectToolIntent(text: string): ToolIntent {
  const asksToCreate =
    /\b(?:tao|xuat|lam|viet|thiet ke|ve|lap|dong goi|gom|cho vao|nhet vao|luu vao|in ra|chuyen|phoi|sang tac|hat)\b.{0,36}\b(?:file|tep|word|excel|docx|xlsx|pdf|bang|bieu do|do thi|so do|mindmap|infographic|anh|hinh|thiep|slide|powerpoint|pptx|nhac|bai hat|ca khuc|beat|track|voice|podcast|audio|am thanh)\b/i.test(text) ||
    /\b(?:vao|ra|thanh|sang)\s+(?:file\s+)?(?:docx|word|excel|xlsx|pptx|slide|pdf|csv|txt)\b/i.test(text);
  if (asksToCreate) return "create";

  const asksToRead = /\b(?:doc|tai|cao|mo|kiem tra|check|phan tich)\b.{0,24}(?:https?:\/\/|\b(?:link|url|website|trang web|tep|file)\b)/i.test(text);
  if (asksToRead) return "read";

  const asksToExecute = /\b(?:chay|thuc thi|execute|run)\b.{0,24}\b(?:code|ma|script|lenh|command|python|shell|terminal)\b/i.test(text);
  if (asksToExecute) return "execute";

  return "none";
}

function detectComplexity(text: string): TaskComplexity {
  const highComplexity =
    text.length >= 520 ||
    /\b(?:phan tich sau|nghien cuu sau|lap ke hoach|chien luoc|lo trinh|nhieu buoc|tung giai doan|toan dien|root cause|kien truc tong the)\b/i.test(text) ||
    (/\b(?:so sanh|danh gia|phan tich)\b/i.test(text) && /\b(?:rui ro|phuong an|de xuat|khuyen nghi|giai phap|trien khai)\b/i.test(text));
  if (highComplexity) return "high";

  const clauseCount = text.split(/(?:[.;!?]|\b(?:sau do|dong thoi|ngoai ra|va sau cung)\b)/i).filter(Boolean).length;
  if (text.length >= 220 || clauseCount >= 3) return "medium";
  return "low";
}

export function deriveExecutionSignals(input: ExecutionSignalInput): ExecutionSignals {
  const text = normalizeText(`${input.question} ${input.quoteText || ""}`);
  const toolIntent = detectToolIntent(text);
  const complexity = detectComplexity(text);
  const riskLevel = input.intent === "fact_check" || input.intent === "realtime_news"
    ? "high"
    : "normal";

  let responseMode: ResponseMode = "fast";
  if (toolIntent !== "none") responseMode = "action";
  else if (complexity === "high") responseMode = "deep";
  else if (input.needsSearch || riskLevel === "high") responseMode = "grounded";

  return { responseMode, complexity, toolIntent, riskLevel };
}

function maxComplexity(a: TaskComplexity, b: TaskComplexity): TaskComplexity {
  const rank: Record<TaskComplexity, number> = { low: 0, medium: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Planner output is untrusted routing advice. Deterministic signals set the
 * minimum safety level and are the only source allowed to request tools.
 */
export function normalizeExecutionSignals(
  raw: Record<string, unknown> | null | undefined,
  input: ExecutionSignalInput,
): ExecutionSignals {
  const derived = deriveExecutionSignals(input);
  const requestedMode = isOneOf(raw?.responseMode, RESPONSE_MODES) ? raw.responseMode : derived.responseMode;
  const requestedComplexity = isOneOf(raw?.complexity, TASK_COMPLEXITIES) ? raw.complexity : derived.complexity;
  const requestedRisk = isOneOf(raw?.riskLevel, RISK_LEVELS) ? raw.riskLevel : derived.riskLevel;

  const complexity = maxComplexity(derived.complexity, requestedComplexity);
  const riskLevel: RiskLevel = derived.riskLevel === "high" || requestedRisk === "high" ? "high" : "normal";
  const toolIntent = derived.toolIntent;

  let responseMode: ResponseMode;
  if (toolIntent !== "none") {
    responseMode = "action";
  } else if (complexity === "high" || requestedMode === "deep") {
    responseMode = "deep";
  } else if (input.needsSearch || riskLevel === "high") {
    responseMode = "grounded";
  } else {
    // `grounded` without a search/evidence requirement and `action` without an
    // explicit tool request are both downgraded to the existing fast path.
    responseMode = "fast";
  }

  return { responseMode, complexity, toolIntent, riskLevel };
}

export function selectResponseMode(params: {
  signals: ExecutionSignals;
  needsSearch: boolean;
  explicitToolRequest?: boolean;
  hasMedia?: boolean;
}): ResponseMode {
  if (params.hasMedia) return "fast";
  if (params.explicitToolRequest) return "action";
  if (params.signals.responseMode === "deep" || params.signals.complexity === "high") return "deep";
  if (params.needsSearch || params.signals.riskLevel === "high") return "grounded";
  return "fast";
}
