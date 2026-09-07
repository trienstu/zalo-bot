"use client";

import * as React from "react";
import {
  Search,
  RefreshCw,
  UserCheck,
  ShieldCheck,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  UserPlus,
  Sparkles,
  Save,
  RotateCcw,
} from "lucide-react";
import { Card, CardTitle, Badge, Button, Input, Table, Th, Td, EmptyState } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export interface FriendItem {
  userId: string;
  displayName: string;
  avatar: string;
  allowDirect: boolean;
  updatedAt: number;
}

export interface FriendSyncInfo {
  pending?: boolean;
  lastSync?: {
    total: number;
    upserted: number;
    updatedAt: number;
  };
}

export interface AutoFriendSettings {
  autoAccept: boolean;
  welcomeMessage: string;
}

export const DEFAULT_TEMPLATE_MESSAGE =
  "Xin chào bạn! Mình là Trợ lý AI Palm River.\n\n" +
  "Rất vui được kết nối cùng bạn! Bạn có thể hỏi mình bất cứ điều gì về:\n" +
  "• Thông tin dự án Palm River & quy hoạch\n" +
  "• Tra cứu tài liệu, thủ tục pháp lý\n" +
  "• Hỗ trợ giải đáp nghiệp vụ, kiến thức bất động sản\n\n" +
  "Hãy nhắn tin trực tiếp cho mình khi bạn cần hỗ trợ nhé!";

export function FriendsManager({
  initialFriends,
  initialSync,
  initialSettings,
  botId = "bot-1",
}: {
  initialFriends: FriendItem[];
  initialSync: FriendSyncInfo;
  initialSettings?: AutoFriendSettings;
  botId?: string;
}) {
  const [friends, setFriends] = React.useState<FriendItem[]>(initialFriends);
  const [syncInfo, setSyncInfo] = React.useState<FriendSyncInfo>(initialSync);
  const [autoAccept, setAutoAccept] = React.useState<boolean>(Boolean(initialSettings?.autoAccept));
  const [welcomeMessage, setWelcomeMessage] = React.useState<string>(
    initialSettings?.welcomeMessage ?? DEFAULT_TEMPLATE_MESSAGE
  );
  const [savingSettings, setSavingSettings] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [filterMode, setFilterMode] = React.useState<"all" | "allowed" | "blocked">("all");
  const [syncing, setSyncing] = React.useState(Boolean(initialSync.pending));
  const [toggleLoadingId, setToggleLoadingId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoAccept,
          welcomeMessage,
          botId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setNotice({ type: "error", text: data.error || "Không thể lưu cấu hình tự động kết bạn." });
      } else {
        setNotice({
          type: "success",
          text: `Đã lưu cài đặt! Tự động kết bạn: ${autoAccept ? "BẬT" : "TẮT"}. Tin nhắn chào mừng đã được cập nhật thành công.`,
        });
      }
    } catch {
      setNotice({ type: "error", text: "Lỗi kết nối khi lưu cài đặt." });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetTemplate = () => {
    setWelcomeMessage(DEFAULT_TEMPLATE_MESSAGE);
  };

  // Poll trạng thái sync nếu đang pending
  React.useEffect(() => {
    let timer: NodeJS.Timeout;
    if (syncing) {
      timer = setInterval(async () => {
        try {
          const res = await fetch(`/api/friends?botId=${encodeURIComponent(botId)}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.ok) {
            setFriends(data.friends || []);
            setSyncInfo(data.sync || {});
            if (!data.sync?.pending) {
              setSyncing(false);
              setNotice({
                type: "success",
                text: `Đã đồng bộ thành công ${data.sync?.lastSync?.total ?? data.friends?.length} bạn bè từ Zalo!`,
              });
            }
          }
        } catch {
          // ignore network error while polling
        }
      }, 2000);
    }
    return () => clearInterval(timer);
  }, [syncing, botId]);

  // Kích hoạt đồng bộ bạn bè từ Zalo
  const handleTriggerSync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch("/api/friends/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncing(false);
        setNotice({ type: "error", text: data.error || "Không thể gửi yêu cầu đồng bộ" });
      } else {
        setNotice({
          type: "success",
          text: "Đã gửi yêu cầu đồng bộ danh sách bạn bè tới Bot Zalo! Đang xử lý...",
        });
      }
    } catch (e) {
      setSyncing(false);
      setNotice({ type: "error", text: "Lỗi kết nối khi gửi yêu cầu đồng bộ." });
    }
  };

  // Bật/tắt quyền tương tác 1:1 cho từng người
  const handleToggleAllow = async (user: FriendItem) => {
    const nextAllow = !user.allowDirect;
    setToggleLoadingId(user.userId);

    // Optimistic UI update
    setFriends((prev) =>
      prev.map((f) => (f.userId === user.userId ? { ...f, allowDirect: nextAllow } : f)),
    );

    try {
      const res = await fetch("/api/friends", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          allowDirect: nextAllow,
          botId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        // Rollback
        setFriends((prev) =>
          prev.map((f) => (f.userId === user.userId ? { ...f, allowDirect: !nextAllow } : f)),
        );
        setNotice({ type: "error", text: data.error || "Không thể cập nhật quyền." });
      } else {
        setNotice({
          type: "success",
          text: nextAllow
            ? `Đã cấp quyền chat 1:1 cho "${user.displayName}". Người này giờ có thể nhắn tin riêng với Bot!`
            : `Đã tắt quyền chat 1:1 của "${user.displayName}". Bot sẽ im lặng khi nhận tin riêng từ người này.`,
        });
      }
    } catch {
      // Rollback
      setFriends((prev) =>
        prev.map((f) => (f.userId === user.userId ? { ...f, allowDirect: !nextAllow } : f)),
      );
      setNotice({ type: "error", text: "Lỗi kết nối khi cập nhật quyền." });
    } finally {
      setToggleLoadingId(null);
    }
  };

  // Lọc theo search & tab
  const filteredFriends = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return friends.filter((f) => {
      const matchQuery =
        !q || f.displayName.toLowerCase().includes(q) || f.userId.toLowerCase().includes(q);
      if (!matchQuery) return false;

      if (filterMode === "allowed") return f.allowDirect;
      if (filterMode === "blocked") return !f.allowDirect;
      return true;
    });
  }, [friends, search, filterMode]);

  const totalCount = friends.length;
  const allowedCount = friends.filter((f) => f.allowDirect).length;

  return (
    <div className="flex flex-col gap-6">
      {/* THÔNG BÁO / TOAST BANNER */}
      {notice && (
        <div
          className={`flex items-center gap-3 rounded-lg border p-4 text-sm transition-all ${
            notice.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-rose-500/30 bg-rose-500/10 text-rose-400"
          }`}
        >
          {notice.type === "success" ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0 text-rose-400" />
          )}
          <span className="flex-1 font-medium">{notice.text}</span>
          <button
            onClick={() => setNotice(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* CẤU HÌNH TỰ ĐỘNG KẾT BẠN & TIN NHẮN CHÀO MỪNG */}
      <Card className="border-indigo-500/30 bg-gradient-to-br from-[var(--color-surface)] via-[var(--color-surface)] to-indigo-950/20 shadow-lg">
        <div className="flex flex-col gap-5">
          {/* Header */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-500/30 shadow-sm">
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[var(--color-text)]">
                  Cấu hình Tự Động Kết Bạn & Tin Nhắn Chào Mừng 1:1
                </h3>
                <p className="text-xs text-[var(--color-muted)]">
                  Bật công tắc để Bot tự động kết bạn khi có người gửi lời mời và gửi tin nhắn chào mừng 1:1.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <Badge tone={autoAccept ? "ok" : "muted"} className="px-2.5 py-1 text-xs font-semibold">
                {autoAccept ? "● Tự động: ĐANG BẬT" : "○ Tự động: ĐANG TẮT"}
              </Badge>
            </div>
          </div>

          <div className="h-px bg-[var(--color-border)]" />

          {/* Switch toggle */}
          <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  Tự động đồng ý khi có lời mời kết bạn mới
                </span>
                <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-400">
                  Delay 2.5s giả lập người thật
                </span>
              </div>
              <p className="text-xs text-[var(--color-muted)]">
                Khi ai đó gửi lời mời kết bạn trên Zalo, Bot sẽ tự động chấp nhận sau 2.5s, cấp quyền trò chuyện 1:1 và gửi tin nhắn chào mừng ngay lập tức.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setAutoAccept(!autoAccept)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                autoAccept ? "bg-emerald-600" : "bg-zinc-700"
              }`}
              title={autoAccept ? "Bấm để TẮT tự động kết bạn" : "Bấm để BẬT tự động kết bạn"}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  autoAccept ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Welcome Message Textarea */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                Nội dung tin nhắn chào mừng (Gửi riêng 1:1 ngay sau khi kết bạn thành công):
              </label>
              <button
                type="button"
                onClick={handleResetTemplate}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                title="Khôi phục lại nội dung lời chào mẫu"
              >
                <RotateCcw className="h-3 w-3" />
                Khôi phục mẫu
              </button>
            </div>

            <textarea
              rows={5}
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              placeholder="Nhập nội dung lời chào mừng bạn mới..."
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs leading-relaxed text-[var(--color-text)] placeholder-[var(--color-muted)] outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
            />
            <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)]">
              <span>💡 Bạn có thể tự do chỉnh sửa nội dung giới thiệu, các lệnh hướng dẫn hoặc thông tin liên hệ tùy ý.</span>
              <span>{welcomeMessage.length} ký tự</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-1">
            <Button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 px-5 font-semibold text-white shadow-md hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50"
            >
              {savingSettings ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Đang lưu cài đặt...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Lưu cài đặt
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* STATS & ACTIONS HEADER */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="flex flex-col justify-between">
          <CardTitle>Tổng số bạn bè Zalo</CardTitle>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight text-[var(--color-text)]">
              {totalCount}
            </span>
            <Badge tone="muted" className="text-xs">
              Đã nạp DB
            </Badge>
          </div>
          <div className="mt-2 text-xs text-[var(--color-muted)]">
            {syncInfo.lastSync?.updatedAt
              ? `Cập nhật lúc: ${fmtDateTime(syncInfo.lastSync.updatedAt)}`
              : "Chưa đồng bộ lần nào"}
          </div>
        </Card>

        <Card className="flex flex-col justify-between border-emerald-500/30 bg-emerald-500/5">
          <CardTitle className="text-emerald-400">Được phép chat 1:1</CardTitle>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight text-emerald-400">
              {allowedCount}
            </span>
            <Badge tone="ok" className="text-xs font-semibold">
              Đang hoạt động
            </Badge>
          </div>
          <div className="mt-2 text-xs text-emerald-400/80">
            Tương tác tự nhiên & Google Search 1:1
          </div>
        </Card>

        <Card className="flex flex-col justify-between">
          <CardTitle>Đồng bộ từ Zalo</CardTitle>
          <div className="mt-3 flex items-center gap-3">
            <Button
              onClick={handleTriggerSync}
              disabled={syncing}
              className="flex-1 items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 font-semibold text-white shadow-md hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Đang đồng bộ..." : "Cập nhật bạn bè"}
            </Button>
          </div>
          <div className="mt-2 text-xs text-[var(--color-muted)]">
            {syncing
              ? "Bot đang kéo danh bạ từ Zalo, vui lòng chờ vài giây..."
              : "Bấm để cập nhật danh bạ bạn bè mới nhất"}
          </div>
        </Card>
      </div>

      {/* FILTER & SEARCH TOOLBAR */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
          <Input
            placeholder="Tìm theo tên bạn bè hoặc Zalo ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
          <button
            onClick={() => setFilterMode("all")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filterMode === "all"
                ? "bg-blue-600 text-white"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            Tất cả ({totalCount})
          </button>
          <button
            onClick={() => setFilterMode("allowed")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filterMode === "allowed"
                ? "bg-emerald-600 text-white"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            Được chat 1:1 ({allowedCount})
          </button>
          <button
            onClick={() => setFilterMode("blocked")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filterMode === "blocked"
                ? "bg-zinc-700 text-white"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            Chưa cấp quyền ({totalCount - allowedCount})
          </button>
        </div>
      </div>

      {/* FRIENDS TABLE */}
      <Card className="overflow-hidden p-0">
        {filteredFriends.length === 0 ? (
          <EmptyState>
            {friends.length === 0
              ? "Chưa có dữ liệu bạn bè nào trong DB. Hãy bấm nút 'Cập nhật bạn bè' ở góc trên để Bot quét danh bạ Zalo."
              : "Không tìm thấy người bạn nào phù hợp với bộ lọc."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                  <Th className="w-12">#</Th>
                  <Th>Bạn bè</Th>
                  <Th>Zalo ID</Th>
                  <Th>Quyền Chat 1:1</Th>
                  <Th>Thời gian cập nhật</Th>
                  <Th className="text-right">Bật/Tắt 1:1</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filteredFriends.map((friend, idx) => (
                  <tr
                    key={friend.userId}
                    className={`transition-colors hover:bg-[var(--color-surface-2)]/50 ${
                      friend.allowDirect ? "bg-emerald-500/[0.03]" : ""
                    }`}
                  >
                    <Td className="text-xs text-[var(--color-muted)]">{idx + 1}</Td>

                    {/* AVATAR & NAME */}
                    <Td>
                      <div className="flex items-center gap-3">
                        {friend.avatar ? (
                          <img
                            src={friend.avatar}
                            alt={friend.displayName}
                            className="h-9 w-9 rounded-full object-cover ring-1 ring-[var(--color-border)]"
                            onError={(e) => {
                              // Fallback nếu ảnh hỏng
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600/20 text-xs font-bold text-indigo-400 ring-1 ring-indigo-500/30">
                            {friend.displayName.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-[var(--color-text)]">
                            {friend.displayName}
                          </div>
                        </div>
                      </div>
                    </Td>

                    {/* USER ID */}
                    <Td>
                      <code className="rounded bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-muted)]">
                        {friend.userId}
                      </code>
                    </Td>

                    {/* PERMISSION BADGE */}
                    <Td>
                      {friend.allowDirect ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                          <MessageSquare className="h-3 w-3" />
                          Được chat 1:1
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-500/15 px-2.5 py-1 text-xs text-zinc-400">
                          <ShieldCheck className="h-3 w-3" />
                          Bot im lặng
                        </span>
                      )}
                    </Td>

                    {/* UPDATED AT */}
                    <Td className="text-xs text-[var(--color-muted)]">
                      {friend.updatedAt ? fmtDateTime(friend.updatedAt) : "—"}
                    </Td>

                    {/* TOGGLE SWITCH */}
                    <Td className="text-right">
                      <button
                        type="button"
                        disabled={toggleLoadingId === friend.userId}
                        onClick={() => handleToggleAllow(friend)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                          friend.allowDirect ? "bg-emerald-600" : "bg-zinc-700"
                        }`}
                        title={
                          friend.allowDirect
                            ? "Bấm để tắt quyền chat 1:1"
                            : "Bấm để cấp quyền chat 1:1 cho người này"
                        }
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            friend.allowDirect ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
