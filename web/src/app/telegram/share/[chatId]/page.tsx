import { Metadata } from "next";
import { getTrackedChatByIdWeb } from "@/lib/telegram-db";
import { TelegramShareClient } from "./share-client";

interface PageProps {
  params: Promise<{ chatId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { chatId } = await params;
  const chat = getTrackedChatByIdWeb(chatId);
  const title = chat?.title ? `Kho Tri Thức: ${chat.title}` : "Kho Tri Thức Telegram";
  return {
    title: `${title} — Chắt Lọc & Tổng Hợp AI`,
    description: `Kho kiến thức và bài học thực chiến tổng hợp từ nhóm Telegram ${chat?.title || ""}`,
  };
}

export default async function TelegramSharePage({ params }: PageProps) {
  const { chatId } = await params;
  return <TelegramShareClient chatId={chatId} />;
}
