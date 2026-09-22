import { Metadata } from "next";
import { Suspense } from "react";
import { ReposClient } from "./repos-client";

export const metadata: Metadata = {
  title: "Kho GitHub Repositories • FindARepo Zalo Community",
  description:
    "Tuyển tập và phân loại mã nguồn mở, AI Agents, Dev Tools và MCP Server được các thành viên chia sẻ trong nhóm Zalo.",
};

export default function ReposPage() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <Suspense
        fallback={
          <div className="min-h-[50vh] flex items-center justify-center text-slate-400">
            Đang tải Kho GitHub Repositories...
          </div>
        }
      >
        <ReposClient />
      </Suspense>
    </div>
  );
}
