import { resolveRequestBotId } from "@/lib/bot-id";
import { PageHeader, EmptyState } from "@/components/ui";
import { dbExists } from "@/lib/db";
import { ZaloMktManager } from "./zalomkt-manager";

export const dynamic = "force-dynamic";

export default async function ZaloMktPage({
  searchParams,
}: {
  searchParams?: Promise<{ botId?: string }>;
}) {
  const params = await searchParams;
  const botId = await resolveRequestBotId(params?.botId);

  if (!dbExists(botId)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Zalo Marketing & Chăm Sóc Khách Hàng (SĐT)" />
        <EmptyState>Chưa có dữ liệu bot. Hãy khởi động Bot Zalo trước rồi quay lại.</EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Zalo Marketing & Chăm Sóc Tự Động Theo SĐT"
        desc="Gửi tin nhắn cá nhân hóa AI chống spam, gửi album cụm ảnh, tự động đổi tên gợi nhớ (Tên + SĐT), quản lý đa chiến dịch và kho dữ liệu khách hàng toàn cục."
      />
      <ZaloMktManager botId={botId} />
    </div>
  );
}
