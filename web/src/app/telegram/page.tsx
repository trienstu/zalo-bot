import { TelegramClient } from "./telegram-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tri Thức & Tài Liệu Telegram | Bot Manager",
  description: "Thu thập tin nhắn từ các group Telegram, tinh lọc tri thức và xuất file Word .docx",
};

export default function TelegramPage() {
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <TelegramClient />
    </div>
  );
}
