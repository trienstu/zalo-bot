"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Terminal,
  RefreshCw,
  Search,
  Copy,
  Check,
  Download,
  Trash2,
  AlertTriangle,
  ArrowDown,
  FileText,
  Database,
  Layers,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
} from "lucide-react";
import { fmtDateTime } from "@/lib/utils";

interface LogLine {
  id: number;
  timestamp?: string;
  level: "ERROR" | "WARN" | "INFO" | "SUCCESS";
  stream: "out" | "error";
  raw: string;
}

interface LogStreamInfo {
  id: string;
  label: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  updatedAt: number;
  exists: boolean;
}

interface DbErrorItem {
  id: number;
  source: string;
  code: string;
  message: string;
  detail: string | null;
  created_at: number;
}

interface MigrationItem {
  version: string;
  applied_at: number;
  note: string | null;
}

interface LogViewerProps {
  initialDbErrors: DbErrorItem[];
  initialMigrations: MigrationItem[];
}

export function LogViewer({ initialDbErrors, initialMigrations }: LogViewerProps) {
  const [activeTab, setActiveTab] = useState<"terminal" | "db_errors" | "migrations">("terminal");

  // Terminal state
  const [stream, setStream] = useState("bot-all");
  const [linesLimit, setLinesLimit] = useState(150);
  const [autoRefreshSec, setAutoRefreshSec] = useState<number>(5); // default 5s
  const [keyword, setKeyword] = useState("");
  const [levelFilter, setLevelFilter] = useState<"ALL" | "ERROR" | "WARN" | "INFO">("ALL");

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [streams, setStreams] = useState<LogStreamInfo[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [sourceFound, setSourceFound] = useState(true);
  const [totalSize, setTotalSize] = useState(0);
  const [botName, setBotName] = useState("Bot");
  const [botId, setBotId] = useState("bot-1");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // DB Errors state
  const [dbSearch, setDbSearch] = useState("");
  const [selectedError, setSelectedError] = useState<DbErrorItem | null>(null);

  const terminalBottomRef = useRef<HTMLDivElement>(null);
  const terminalBoxRef = useRef<HTMLDivElement>(null);

  // Fetch logs from API
  const loadLogs = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("stream", stream);
      params.set("lines", String(linesLimit));
      if (keyword.trim()) params.set("keyword", keyword.trim());

      const res = await fetch(`/api/logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.lines || []);
        if (data.streams) setStreams(data.streams);
        if (data.sourceName) setSourceName(data.sourceName);
        setSourceFound(!!data.sourceFound);
        setTotalSize(data.totalSize || 0);
        if (data.botName) setBotName(data.botName);
        if (data.botId) setBotId(data.botId);
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error("Lỗi tải logs:", err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  // Trigger load on tab switch, stream change, lines change
  useEffect(() => {
    if (activeTab === "terminal") {
      loadLogs();
    }
  }, [activeTab, stream, linesLimit]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === "terminal") {
        loadLogs(true);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  // Auto-refresh interval
  useEffect(() => {
    if (activeTab !== "terminal" || autoRefreshSec <= 0) return;
    const interval = setInterval(() => {
      loadLogs(true);
    }, autoRefreshSec * 1000);
    return () => clearInterval(interval);
  }, [activeTab, autoRefreshSec, stream, linesLimit, keyword]);

  // Auto-scroll to bottom on first load
  const scrollToBottom = () => {
    if (terminalBoxRef.current) {
      terminalBoxRef.current.scrollTop = terminalBoxRef.current.scrollHeight;
    }
  };

  // Copy logs
  const handleCopyLogs = () => {
    const text = filteredLogs.map((l) => l.raw).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download logs
  const handleDownloadLogs = () => {
    const text = filteredLogs.map((l) => l.raw).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sourceName || "pm2-log"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Truncate logs on VPS
  const handleClearServerLogs = async () => {
    if (!window.confirm("Bạn có chắc chắn muốn XÓA TRẮNG nội dung file log này trên VPS không? Thao tác này không thể hoàn tác.")) {
      return;
    }
    try {
      setLoading(true);
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId: stream, botId }),
      });
      if (res.ok) {
        await loadLogs();
      }
    } catch (err) {
      console.error("Lỗi xóa log:", err);
    } finally {
      setLoading(false);
    }
  };

  // Filter logs by level
  const filteredLogs = useMemo(() => {
    if (levelFilter === "ALL") return logs;
    return logs.filter((l) => l.level === levelFilter);
  }, [logs, levelFilter]);

  // Filter DB errors
  const filteredDbErrors = useMemo(() => {
    if (!dbSearch.trim()) return initialDbErrors;
    const q = dbSearch.toLowerCase();
    return initialDbErrors.filter(
      (e) =>
        e.source.toLowerCase().includes(q) ||
        (e.code && e.code.toLowerCase().includes(q)) ||
        e.message.toLowerCase().includes(q) ||
        (e.detail && e.detail.toLowerCase().includes(q))
    );
  }, [initialDbErrors, dbSearch]);

  const errorCount = useMemo(() => {
    return logs.filter((l) => l.level === "ERROR").length;
  }, [logs]);

  return (
    <div className="space-y-5">
      {/* Header & Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <Terminal className="h-6 w-6 text-cyan-400" />
              <span>Nhật Ký & Lỗi Hệ Thống</span>
            </h1>
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-semibold text-cyan-400">
              {botName}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Theo dõi trực tiếp log tiến trình PM2 realtime, bắt lỗi Zalo / AI và tra cứu lịch sử lỗi.
          </p>
        </div>

        {/* Tab switcher buttons */}
        <div className="flex items-center gap-1 rounded-xl bg-slate-900/90 p-1 border border-slate-800 shadow-inner">
          <button
            type="button"
            onClick={() => setActiveTab("terminal")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              activeTab === "terminal"
                ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>Terminal Logs</span>
            {errorCount > 0 && (
              <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                activeTab === "terminal" ? "bg-rose-900 text-rose-200" : "bg-rose-500/20 text-rose-400"
              }`}>
                {errorCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("db_errors")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              activeTab === "db_errors"
                ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            <span>Lỗi Database</span>
            <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
              activeTab === "db_errors" ? "bg-slate-950 text-cyan-300" : "bg-slate-800 text-slate-300"
            }`}>
              {initialDbErrors.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("migrations")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              activeTab === "migrations"
                ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Migrations</span>
          </button>
        </div>
      </div>

      {/* ================= TAB 1: TERMINAL LIVE LOGS ================= */}
      {activeTab === "terminal" && (
        <div className="space-y-3">
          {/* Controls toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-900/80 p-3 shadow-lg backdrop-blur-md">
            {/* Left controls: Stream & Level */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Stream selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Nguồn:</span>
                <select
                  value={stream}
                  onChange={(e) => setStream(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="bot-all">🤖 Bot: Toàn bộ log (Out + Error)</option>
                  <option value="bot-error">⚠️ Bot: Chỉ Log Lỗi (zalo-bot-*-error.log)</option>
                  <option value="bot-out">📋 Bot: Chỉ Hoạt động (zalo-bot-*-out.log)</option>
                  <option value="web-out">🌐 Web Dashboard (zalo-web-*-out.log)</option>
                  <option value="web-error">🚨 Web Lỗi (zalo-web-*-error.log)</option>
                  {streams
                    .filter((s) => !["bot-all", "bot-error", "bot-out", "web-out", "web-error"].includes(s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        📄 {s.label} ({Math.round(s.sizeBytes / 1024)} KB)
                      </option>
                    ))}
                </select>
              </div>

              {/* Level filter tabs */}
              <div className="flex items-center rounded-lg bg-slate-950 p-0.5 border border-slate-800">
                {(["ALL", "ERROR", "WARN", "INFO"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevelFilter(lvl)}
                    className={`px-2 py-1 text-[11px] font-semibold rounded transition-all ${
                      levelFilter === lvl
                        ? lvl === "ERROR"
                          ? "bg-rose-500 text-white"
                          : lvl === "WARN"
                          ? "bg-amber-500 text-slate-950"
                          : "bg-slate-700 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {lvl === "ALL" ? "Tất cả" : lvl}
                  </button>
                ))}
              </div>

              {/* Lines limit */}
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-400">Dòng:</span>
                <select
                  value={linesLimit}
                  onChange={(e) => setLinesLimit(Number(e.target.value))}
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={150}>150</option>
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                </select>
              </div>
            </div>

            {/* Right controls: Search, Auto-refresh, Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Keyword search input */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Lọc từ khóa..."
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="w-36 sm:w-48 rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
                {keyword && (
                  <button
                    type="button"
                    onClick={() => setKeyword("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Auto refresh setting */}
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1">
                <div className={`h-2 w-2 rounded-full ${autoRefreshSec > 0 ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                <span className="text-[11px] text-slate-400">Auto:</span>
                <select
                  value={autoRefreshSec}
                  onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
                  className="bg-transparent text-xs text-slate-200 focus:outline-none"
                >
                  <option value={0}>Tắt</option>
                  <option value={3}>3s</option>
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                </select>
              </div>

              {/* Action buttons */}
              <button
                type="button"
                onClick={() => loadLogs()}
                disabled={loading}
                title="Làm mới ngay"
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-cyan-400" : ""}`} />
                <span className="hidden sm:inline">Làm mới</span>
              </button>

              <button
                type="button"
                onClick={scrollToBottom}
                title="Cuộn xuống đáy"
                className="rounded-lg border border-slate-700 bg-slate-800/80 p-1.5 text-slate-300 hover:bg-slate-700 transition-all"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={handleCopyLogs}
                title="Sao chép toàn bộ log"
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-all"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{copied ? "Đã chép!" : "Sao chép"}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadLogs}
                title="Tải log về máy (.log)"
                className="rounded-lg border border-slate-700 bg-slate-800/80 p-1.5 text-slate-300 hover:bg-slate-700 transition-all"
              >
                <Download className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={handleClearServerLogs}
                title="Xoá sạch file log trên VPS"
                className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-400 hover:bg-rose-500/20 transition-all"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Terminal Box */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-[#070B14] shadow-2xl">
            {/* Terminal Topbar (macOS style) */}
            <div className="flex items-center justify-between border-b border-slate-800/90 bg-[#0D1322] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-rose-500/80" />
                  <div className="h-3 w-3 rounded-full bg-amber-500/80" />
                  <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
                </div>
                <div className="ml-3 flex items-center gap-2 font-mono text-xs text-slate-400">
                  <span className="text-cyan-400 font-semibold">{botName}</span>
                  <span>—</span>
                  <span className="text-slate-300">{sourceName || "pm2 logs"}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
                {lastUpdated && (
                  <span className="hidden sm:inline text-slate-500">
                    Cập nhật: {lastUpdated.toLocaleTimeString("vi-VN")}
                  </span>
                )}
                <span className="rounded bg-slate-800/80 px-2 py-0.5 text-slate-300">
                  {filteredLogs.length} / {logs.length} dòng
                </span>
                {totalSize > 0 && (
                  <span className="rounded bg-slate-800/80 px-2 py-0.5 text-cyan-300">
                    {Math.round(totalSize / 1024)} KB
                  </span>
                )}
              </div>
            </div>

            {/* Terminal Body */}
            <div
              ref={terminalBoxRef}
              className="h-[600px] overflow-y-auto p-4 font-mono text-xs leading-relaxed text-slate-300 selection:bg-cyan-500 selection:text-slate-950 scroll-smooth"
            >
              {!sourceFound ? (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-amber-400 mb-3">
                    <AlertTriangle className="h-8 w-8" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-200 mb-1">Chưa tìm thấy file log PM2</h3>
                  <p className="max-w-md text-xs text-slate-400 leading-relaxed mb-4">
                    Nếu bạn đang chạy ứng dụng ở môi trường phát triển local (Mac), file log PM2 chưa tồn tại.
                    Khi chạy trên VPS qua lệnh PM2, log tiến trình sẽ tự động xuất hiện tại đây theo thời gian thực.
                  </p>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-left font-mono text-xs text-slate-400">
                    <p className="text-cyan-400 font-semibold mb-1">Đường dẫn file trên VPS:</p>
                    <p className="text-slate-300">~/.pm2/logs/zalo-bot-{botId === "bot-2" ? "2" : "1"}-out.log</p>
                    <p className="text-slate-300">~/.pm2/logs/zalo-bot-{botId === "bot-2" ? "2" : "1"}-error.log</p>
                  </div>
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-500">
                  <Terminal className="h-8 w-8 mb-2 text-slate-600" />
                  <p className="text-xs">Không có dòng log nào phù hợp với bộ lọc hiện tại.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredLogs.map((line, idx) => {
                    const isError = line.level === "ERROR" || line.stream === "error";
                    const isWarn = line.level === "WARN";
                    const isSuccess = line.level === "SUCCESS";

                    return (
                      <div
                        key={`${line.id}-${idx}`}
                        className={`group flex items-start gap-2 rounded px-2 py-0.5 transition-colors ${
                          isError
                            ? "bg-rose-950/30 text-rose-300 border-l-2 border-rose-500"
                            : isWarn
                            ? "bg-amber-950/20 text-amber-200 border-l-2 border-amber-500"
                            : isSuccess
                            ? "text-emerald-300"
                            : "hover:bg-slate-800/40 text-slate-300"
                        }`}
                      >
                        {/* Line number */}
                        <span className="w-8 shrink-0 select-none text-right text-[11px] text-slate-600 group-hover:text-slate-400">
                          {idx + 1}
                        </span>

                        {/* Stream badge */}
                        <span
                          className={`shrink-0 rounded px-1 text-[10px] font-bold ${
                            line.stream === "error"
                              ? "bg-rose-500/20 text-rose-400"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {line.stream === "error" ? "ERR" : "OUT"}
                        </span>

                        {/* Timestamp */}
                        {line.timestamp && (
                          <span className="shrink-0 text-[11px] text-cyan-400/70 select-none">
                            {line.timestamp}
                          </span>
                        )}

                        {/* Level tag if not standard */}
                        {isError && (
                          <span className="shrink-0 rounded bg-rose-500 px-1 py-0.2 text-[10px] font-bold text-slate-950">
                            ERROR
                          </span>
                        )}
                        {isWarn && (
                          <span className="shrink-0 rounded bg-amber-500 px-1 py-0.2 text-[10px] font-bold text-slate-950">
                            WARN
                          </span>
                        )}

                        {/* Log message content */}
                        <span className="break-all whitespace-pre-wrap flex-1">
                          {line.raw.replace(line.timestamp || "", "").trim() || line.raw}
                        </span>
                      </div>
                    );
                  })}
                  <div ref={terminalBottomRef} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: DATABASE ERRORS ================= */}
      {activeTab === "db_errors" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <span className="text-sm font-semibold text-white">
                Bảng Lỗi Vận Hành Trong Cơ Sở Dữ Liệu ({filteredDbErrors.length} lỗi)
              </span>
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm kiếm lỗi DB..."
                value={dbSearch}
                onChange={(e) => setDbSearch(e.target.value)}
                className="w-64 rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {filteredDbErrors.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-400">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400 mb-2" />
              <p className="text-sm">Không có bản ghi lỗi nào trong cơ sở dữ liệu.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Thời gian</th>
                      <th className="px-4 py-3 font-semibold">Nguồn</th>
                      <th className="px-4 py-3 font-semibold">Mã lỗi</th>
                      <th className="px-4 py-3 font-semibold">Thông điệp</th>
                      <th className="px-4 py-3 font-semibold">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredDbErrors.map((err) => (
                      <tr
                        key={err.id}
                        onClick={() => setSelectedError(err)}
                        className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-slate-400 font-mono">
                          {fmtDateTime(err.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-400">
                            {err.source}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-400">
                          {err.code || "—"}
                        </td>
                        <td className="max-w-md truncate px-4 py-3 font-medium text-slate-200" title={err.message}>
                          {err.message}
                        </td>
                        <td className="max-w-xs truncate px-4 py-3 font-mono text-slate-500" title={err.detail || ""}>
                          {err.detail ? "Xem chi tiết →" : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Modal chi tiết lỗi */}
          {selectedError && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
              <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-400">
                      {selectedError.source}
                    </span>
                    <h3 className="font-semibold text-white">Chi tiết lỗi #{selectedError.id}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedError(null)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-slate-400 font-medium">Thời gian:</span>
                    <p className="mt-0.5 font-mono text-slate-200">{fmtDateTime(selectedError.created_at)}</p>
                  </div>
                  {selectedError.code && (
                    <div>
                      <span className="text-slate-400 font-medium">Mã lỗi (Code):</span>
                      <p className="mt-0.5 font-mono text-amber-400">{selectedError.code}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-slate-400 font-medium">Thông điệp (Message):</span>
                    <p className="mt-0.5 rounded-lg bg-slate-950 p-3 font-mono text-rose-300 border border-rose-500/20">
                      {selectedError.message}
                    </p>
                  </div>
                  {selectedError.detail && (
                    <div>
                      <span className="text-slate-400 font-medium">Chi tiết kỹ thuật / Stack Trace:</span>
                      <pre className="mt-0.5 max-h-60 overflow-y-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-slate-300 border border-slate-800 whitespace-pre-wrap">
                        {selectedError.detail}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `[${selectedError.source}] ${selectedError.message}\n${selectedError.detail || ""}`
                      );
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>Sao chép</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedError(null)}
                    className="rounded-lg bg-cyan-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 3: MIGRATIONS ================= */}
      {activeTab === "migrations" && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Layers className="h-5 w-5 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Lịch Sử Schema Migrations Đã Áp Dụng</h3>
          </div>

          {initialMigrations.length === 0 ? (
            <p className="text-xs text-slate-500">Cơ sở dữ liệu chưa ghi nhận schema version nào.</p>
          ) : (
            <div className="grid gap-2">
              {initialMigrations.map((m) => (
                <div
                  key={m.version}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-3 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-bold text-cyan-400">{m.version}</span>
                    {m.note && <span className="text-slate-400">— {m.note}</span>}
                  </div>
                  <span className="font-mono text-slate-500">{fmtDateTime(m.applied_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
