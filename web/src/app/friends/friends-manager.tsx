"use client";

import * as React from "react";
import { Search, RefreshCw, UserCheck, ShieldCheck, MessageSquare, AlertCircle, CheckCircle2 } from "lucide-react";
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

export function FriendsManager({
  initialFriends,
  initialSync,
  botId = "bot-1",
}: {
  initialFriends: FriendItem[];
  initialSync: FriendSyncInfo;
  botId?: string;
}) {
  const [friends, setFriends] = React.useState<FriendItem[]>(initialFriends);
  const [syncInfo, setSyncInfo] = React.useState<FriendSyncInfo>(initialSync);
  const [search, setSearch] = React.useState("");
  const [filterMode, setFilterMode] = React.useState<"all" | "allowed" | "blocked">("all");
  const [syncing, setSyncing] = React.useState(Boolean(initialSync.pending));
  const [toggleLoadingId, setToggleLoadingId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

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
