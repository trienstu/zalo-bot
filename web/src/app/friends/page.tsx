import fs from "node:fs";
import { PageHeader, EmptyState } from "@/components/ui";
import { dbExists, listBotFriends, getFriendSyncStatus } from "@/lib/db";
import { friendSyncRequestPath } from "@/lib/login-status";
import { FriendsManager } from "./friends-manager";

export const dynamic = "force-dynamic";

export default async function FriendsPage({
  searchParams,
}: {
  searchParams?: Promise<{ botId?: string }>;
}) {
  if (!dbExists()) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Bạn Bè Zalo & Chat 1:1" />
        <EmptyState>Chưa có dữ liệu bot. Hãy khởi động Bot Zalo trước rồi quay lại.</EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const botId = params?.botId || "bot-1";
  const initialFriends = listBotFriends(botId);
  const syncStatus = getFriendSyncStatus(botId);
  const requestPath = friendSyncRequestPath(botId);
  const isPending = fs.existsSync(requestPath);

  const initialSync = {
    ...syncStatus,
    pending: isPending,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quản Lý Bạn Bè & Cấp Quyền Chat 1:1"
        desc="Đồng bộ danh sách bạn bè từ Zalo và bật/tắt quyền trò chuyện 1:1 với Bot cho từng cá nhân dưới tư cách thành viên thường."
      />
      <FriendsManager
        initialFriends={initialFriends}
        initialSync={initialSync}
        botId={botId}
      />
    </div>
  );
}
