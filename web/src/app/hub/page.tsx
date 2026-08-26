import { Metadata } from "next";
import { HubClient } from "./hub-client";

export const metadata: Metadata = {
  title: "Kho Kiến Thức & Tài Nguyên Cộng Đồng | Zalo Community Hub",
  description:
    "Tổng hợp kinh nghiệm, tút kiếm tiền, hướng dẫn AI, kho link và tài liệu được chia sẻ từ cộng đồng Zalo mỗi ngày.",
};

export default function HubPage() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <HubClient />
    </div>
  );
}
