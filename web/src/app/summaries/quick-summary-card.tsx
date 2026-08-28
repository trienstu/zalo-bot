"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Send, Clock, Check, Copy, RefreshCw, AlertCircle, Cpu, Database, CheckCircle2 } from "lucide-react";
import { Card, CardTitle, Button, Input, Badge } from "@/components/ui";

export function QuickSummaryCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentGroupId = searchParams.get("group") || "1913869945242410752";
  const groupLabel =
    currentGroupId === "1913869945242410752"
      ? 'nhóm "GROUP TRAO ĐỔI - AI, CÔNG NGHỆ"'
      : currentGroupId === "6918708484908920459"
        ? 'nhóm "HỘI ĂN NHẬU 🍻"'
        : "nhóm đang chọn";

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [sendDirectly, setSendDirectly] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<string>("Đang chuẩn bị...");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [sendingToZalo, setSendingToZalo] = useState<boolean>(false);
  const [sentSuccess, setSentSuccess] = useState<boolean>(false);

  const [result, setResult] = useState<{
    dayLabel: string;
    summary: string;
    fullMessage: string;
    stats: { totalMessages: number; uniqueSenders: number; topSenders: string[] };
    sent: boolean;
  } | null>(null);

  // Schedule settings
  const [autoEnabled, setAutoEnabled] = useState<boolean>(true);
  const [autoTime, setAutoTime] = useState<string>("23:00");
  const [savingSchedule, setSavingSchedule] = useState<boolean>(false);
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    // Load schedule config
    fetch("/api/summaries/schedule")
      .then((r) => r.json())
      .then((data) => {
        if (data.enabled !== undefined) setAutoEnabled(data.enabled);
        if (data.time) setAutoTime(data.time);
      })
      .catch(() => {});

    return () => {
      timerRef.current.forEach(clearTimeout);
    };
  }, []);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setResult(null);
    setSentSuccess(false);
    setProgressPercent(15);
    setCurrentStep("🔍 Đang đọc và tổng hợp tin nhắn trong Database...");

    timerRef.current.forEach(clearTimeout);
    timerRef.current = [
      setTimeout(() => {
        setProgressPercent(45);
        setCurrentStep("🤖 Đang gửi dữ liệu đến Gemini AI (gemini-3.6-flash)...");
      }, 2000),
      setTimeout(() => {
        setProgressPercent(75);
        setCurrentStep("✍️ Gemini AI đang phân tích chủ đề, đúc kết kinh nghiệm & xếp hạng tương tác...");
      }, 6000),
      setTimeout(() => {
        setProgressPercent(90);
        setCurrentStep("🚀 Đang hoàn tất bản tin và lưu trữ...");
      }, 12000),
    ];

    try {
      const res = await fetch("/api/summaries/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetDate: selectedDate,
          sendToGroup: sendDirectly,
          groupId: currentGroupId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.error || "Không thể tạo bản tóm tắt");
      }

      setProgressPercent(100);
      setCurrentStep("✅ Hoàn tất tóm tắt!");
      setResult(data);
      if (data.sent) {
        setSentSuccess(true);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đã có lỗi xảy ra");
    } finally {
      timerRef.current.forEach(clearTimeout);
      setLoading(false);
    }
  }

  async function handleSendToZalo() {
    if (!result?.fullMessage) return;
    setSendingToZalo(true);
    try {
      const res = await fetch("/api/summaries/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: result.fullMessage,
          groupId: currentGroupId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Lỗi khi gửi vào Zalo");
      }
      setSentSuccess(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Không gửi được vào nhóm Zalo");
    } finally {
      setSendingToZalo(false);
    }
  }

  async function handleSaveSchedule() {
    setSavingSchedule(true);
    setScheduleMsg(null);
    try {
      const res = await fetch("/api/summaries/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: autoEnabled, time: autoTime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi khi lưu lịch hẹn");
      setScheduleMsg("✅ Đã lưu lịch hẹn tự động!");
      setTimeout(() => setScheduleMsg(null), 4000);
    } catch (e) {
      setScheduleMsg(`❌ ${e instanceof Error ? e.message : "Lỗi lưu"}`);
    } finally {
      setSavingSchedule(false);
    }
  }

  function copyToClipboard() {
    if (!result?.fullMessage) return;
    navigator.clipboard.writeText(result.fullMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Cột 1 & 2: Tạo Tóm Tắt Tức Thì */}
      <Card className="p-5 lg:col-span-2 border-cyan-500/20 bg-gradient-to-br from-[var(--color-card)] to-cyan-950/10">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Tóm tắt tức thì (Gemini AI)</CardTitle>
              <p className="text-xs text-[var(--color-muted)]">
                Tự động gom tin nhắn trong ngày và dùng Gemini AI tóm tắt các chủ đề thảo luận chính
              </p>
            </div>
          </div>
          <Badge tone="ok" className="text-xs">Gemini 3.5 Flash</Badge>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedDate(todayStr)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedDate === todayStr
                    ? "bg-cyan-500 text-black font-semibold"
                    : "bg-[var(--color-card-subtle)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                Hôm nay
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(yesterdayStr)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedDate === yesterdayStr
                    ? "bg-cyan-500 text-black font-semibold"
                    : "bg-[var(--color-card-subtle)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                Hôm qua
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[var(--color-muted)]">Ngày:</span>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-8 w-auto min-w-[130px] text-xs"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--color-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sendDirectly}
              onChange={(e) => setSendDirectly(e.target.checked)}
              className="rounded border-[var(--color-border)] text-cyan-500 focus:ring-cyan-500"
            />
            <span>Tự động gửi vào Zalo</span>
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={handleGenerate}
            disabled={loading}
            className="bg-cyan-500 text-black hover:bg-cyan-400 font-semibold text-xs px-5 py-2.5 flex items-center gap-2 shadow-lg shadow-cyan-500/10 cursor-pointer"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Đang xử lý...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span>Bắt đầu tóm tắt</span>
              </>
            )}
          </Button>
        </div>

        {/* Khung hiển thị tiến trình thời gian thực khi đang chạy */}
        {loading && (
          <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-medium text-cyan-300 flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                {currentStep}
              </span>
              <span className="font-mono text-cyan-400">{progressPercent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-cyan-950/40 border border-cyan-500/20">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-2.5 flex items-center gap-4 text-[11px] text-[var(--color-muted)]">
              <span className="flex items-center gap-1">
                <Database className="h-3 w-3 text-cyan-400" /> SQLite DB
              </span>
              <span>→</span>
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3 text-purple-400" /> Gemini 3.6 Flash
              </span>
              <span>→</span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Tổng hợp bản tin
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-md bg-rose-500/10 p-3 text-xs text-rose-400 border border-rose-500/20">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card-subtle)] p-4">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-3">
              <div className="flex items-center gap-2">
                <Badge tone="ok">Ngày {result.dayLabel}</Badge>
                <span className="text-xs text-[var(--color-muted)]">
                  {result.stats.totalMessages} tin nhắn · {result.stats.uniqueSenders} người tham gia
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={copyToClipboard}
                  className="h-7 px-2 text-xs flex items-center gap-1.5 bg-[var(--color-card)] hover:bg-[var(--color-border)] text-[var(--color-text)]"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? "Đã copy" : "Copy"}</span>
                </Button>

                <Button
                  onClick={handleSendToZalo}
                  disabled={sendingToZalo || sentSuccess}
                  className={`h-7 px-2.5 text-xs flex items-center gap-1.5 font-medium ${
                    sentSuccess
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-blue-600 hover:bg-blue-500 text-white"
                  }`}
                >
                  {sendingToZalo ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : sentSuccess ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  <span>{sendingToZalo ? "Đang gửi..." : sentSuccess ? "Đã gửi vào nhóm Zalo" : "Gửi vào nhóm Zalo"}</span>
                </Button>
              </div>
            </div>

            <pre className="max-h-[350px] overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-[var(--color-text)] select-text">
              {result.fullMessage}
            </pre>
          </div>
        )}
      </Card>

      {/* Cột 3: Cài đặt Hẹn Giờ Tự Động */}
      <Card className="p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Lịch hẹn tự động</CardTitle>
              <p className="text-xs text-[var(--color-muted)]">Bot tự động tóm tắt & gửi vào nhóm</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-4">
            <label className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3 cursor-pointer bg-[var(--color-card-subtle)]">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-[var(--color-text)]">Bật tự động hằng ngày</span>
                <span className="text-[11px] text-[var(--color-muted)]">Chạy ngầm trong bot worker</span>
              </div>
              <input
                type="checkbox"
                checked={autoEnabled}
                onChange={(e) => setAutoEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--color-border)] text-cyan-500 focus:ring-cyan-500"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text)]">Khung giờ tóm tắt (Giờ Việt Nam):</label>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={autoTime}
                  onChange={(e) => setAutoTime(e.target.value)}
                  disabled={!autoEnabled}
                  className="h-9 text-xs"
                />
                <span className="text-xs text-[var(--color-muted)]">mỗi ngày</span>
              </div>
              <p className="text-[11px] text-[var(--color-muted)] mt-1">
                Gợi ý: <code>23:00</code> để tóm tắt trọn vẹn cả ngày, hoặc <code>07:30</code> sáng hôm sau.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 border-t border-[var(--color-border)] pt-4">
          <Button
            onClick={handleSaveSchedule}
            disabled={savingSchedule}
            className="w-full text-xs py-2 bg-[var(--color-card-subtle)] hover:bg-[var(--color-border)] text-[var(--color-text)]"
          >
            {savingSchedule ? "Đang lưu..." : "Lưu cài đặt lịch hẹn"}
          </Button>

          {scheduleMsg && (
            <p className="mt-2 text-center text-xs font-medium text-[var(--color-text)]">{scheduleMsg}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
