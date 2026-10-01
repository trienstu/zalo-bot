"use client";

import React, { useState, useEffect } from "react";
import {
  BookOpen,
  Download,
  Search,
  RefreshCw,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileText,
  MessageSquare,
  CheckCircle2,
  Quote,
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { Badge, Button } from "@/components/ui";

const CATEGORIES = [
  { id: "all", label: "Tất cả", icon: "🌐" },
  { id: "trading_signals", label: "Kèo & Setup", icon: "🎯" },
  { id: "technical_analysis", label: "PT Kỹ Thuật", icon: "📊" },
  { id: "macro_news", label: "Vĩ Mô & Dòng Tiền", icon: "🌐" },
  { id: "risk_psychology", label: "Quản Trị Rủi Ro", icon: "🛡️" },
  { id: "shared_files", label: "File & Tài Liệu", icon: "📁" },
  { id: "ai_prompt", label: "AI & Prompt", icon: "🤖" },
  { id: "tools_tech", label: "Công Cụ & Tech", icon: "🛠️" },
  { id: "business_real_estate", label: "Kinh Doanh & BĐS", icon: "📈" },
  { id: "tips_workflow", label: "Quy Trình & Tips", icon: "⚡" },
  { id: "news_insight", label: "Tin Tức & Insights", icon: "📰" },
  { id: "general", label: "Khác", icon: "💡" },
];

interface ShareClientProps {
  chatId: string;
}

export function TelegramShareClient({ chatId }: ShareClientProps) {
  const [chat, setChat] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bộ lọc
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Trạng thái mở rộng xem nội dung gốc từng bài
  const [expandedOriginalIds, setExpandedOriginalIds] = useState<Record<number, boolean>>({});

  // Trạng thái xuất Word
  const [exportingAll, setExportingAll] = useState(false);
  const [exportingItemId, setExportingItemId] = useState<number | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("chatId", chatId);
      if (selectedCategory !== "all") params.set("category", selectedCategory);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/telegram/share?${params.toString()}`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Không thể tải dữ liệu.");
      } else {
        setChat(data.chat);
        setItems(data.items || []);
      }
    } catch (err: any) {
      setError(err.message || "Lỗi kết nối máy chủ.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [chatId, selectedCategory]);

  const toggleOriginal = (id: number) => {
    setExpandedOriginalIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleExportAllWord = () => {
    setExportingAll(true);
    const params = new URLSearchParams();
    params.set("chatId", chatId);
    if (selectedCategory !== "all") params.set("category", selectedCategory);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());

    const url = `/api/telegram/export-word?${params.toString()}`;
    window.location.href = url;
    setTimeout(() => setExportingAll(false), 2500);
  };

  const handleExportSingleWord = (itemId: number) => {
    setExportingItemId(itemId);
    const url = `/api/telegram/export-word?itemId=${itemId}`;
    window.location.href = url;
    setTimeout(() => setExportingItemId(null), 2500);
  };

  const handleCopyLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header Navigation */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/85 backdrop-blur-md px-4 py-3">
        <div className="container mx-auto flex items-center justify-between max-w-7xl">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/20">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs uppercase tracking-wider font-semibold text-blue-400">
                Kho Tri Thức Nhóm
              </span>
              <h1 className="text-sm sm:text-base font-bold text-white truncate max-w-[240px] sm:max-w-md">
                {chat?.title || "Nhóm Telegram"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 h-8 px-2.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800"
              title="Sao chép liên kết kho tri thức này"
            >
              {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{copiedLink ? "Đã copy link" : "Copy Link"}</span>
            </Button>

            <Button
              variant="ghost"
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 h-8 px-2.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Làm mới</span>
            </Button>

            <Button
              onClick={handleExportAllWord}
              disabled={exportingAll || items.length === 0}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/25 font-medium px-3.5 h-8 text-xs rounded-lg"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{exportingAll ? "Đang xuất..." : `Xuất Tất Cả Word [${items.length}]`}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl space-y-6">
        {/* Banner giới thiệu nhóm */}
        <div className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-r from-blue-950/40 via-slate-900 to-indigo-950/30 p-6 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-blue-500/10 text-blue-300 border border-blue-500/30">
                  ⚡ Auto Knowledge Collector
                </span>
                {chat?.username && (
                  <span className="text-xs text-slate-400">@{chat.username}</span>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                {chat?.title || "Kho Tri Thức Chuyên Sâu"}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
                Toàn bộ thảo luận, kinh nghiệm thực chiến và tài liệu chia sẻ từ nhóm được AI tự động phân loại, tóm tắt bài học cốt lõi và lưu giữ nguyên vẹn nội dung gốc để tra cứu & xuất bản tài liệu Word.
              </p>
            </div>

            <div className="flex sm:flex-col items-center sm:items-end gap-2 text-right shrink-0">
              <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-center sm:text-right">
                <div className="text-lg font-bold text-blue-400">{items.length}</div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider">Bài Học Tri Thức</div>
              </div>
            </div>
          </div>
        </div>

        {/* Thanh công cụ tìm kiếm & lọc chuyên mục */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 space-y-3 shadow-md backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase text-slate-400 mr-2">Chủ đề:</span>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCategory(c.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  selectedCategory === c.id
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                <span>{c.icon}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-slate-800/80">
            <div className="flex items-center gap-2 flex-1 rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-1.5 focus-within:border-blue-500/60 transition-colors">
              <Search className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="Tìm kiếm theo tiêu đề, bài học, thuật ngữ hoặc nội dung gốc..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchData()}
                className="w-full bg-transparent text-xs text-white focus:outline-none placeholder:text-slate-500"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    fetchData();
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Xóa
                </button>
              )}
            </div>

            <Button
              variant="ghost"
              onClick={fetchData}
              className="text-xs h-8 px-3 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800"
            >
              Tìm
            </Button>
          </div>
        </div>

        {/* Thông báo lỗi nếu có */}
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-300 text-xs">
            {error}
          </div>
        )}

        {/* Danh sách các bài tri thức */}
        {loading ? (
          <div className="py-16 text-center space-y-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto" />
            <p className="text-xs text-slate-400">Đang tải kho tri thức nhóm...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
              <BookOpen className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-white">Chưa có bài tri thức nào phù hợp</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Không tìm thấy mục tri thức nào theo bộ lọc này. Hãy thử chọn "Tất cả" hoặc xóa từ khóa tìm kiếm.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {items.map((item) => {
              const isExpanded = Boolean(expandedOriginalIds[item.id]);
              const isExportingThis = exportingItemId === item.id;

              return (
                <div
                  key={item.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm hover:border-blue-500/40 transition-all space-y-4"
                >
                  <div className="space-y-3">
                    {/* Top Row: Category + Date */}
                    <div className="flex items-center justify-between gap-2">
                      <Badge className="text-[11px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">
                        {item.category}
                      </Badge>
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {item.date_range || new Date(item.created_at).toLocaleDateString("vi-VN")}
                      </span>
                    </div>

                    {/* Tiêu đề */}
                    <h3 className="text-sm sm:text-base font-bold text-white leading-snug">
                      {item.title}
                    </h3>

                    {/* Tóm tắt */}
                    <div className="text-xs text-slate-300 leading-relaxed space-y-1">
                      <span className="font-semibold text-blue-400 block text-[11px] uppercase tracking-wider">
                        📌 Tóm tắt cốt lõi:
                      </span>
                      <p>{item.summary}</p>
                    </div>

                    {/* Điểm mấu chốt & Bài học */}
                    {item.key_takeaways && item.key_takeaways.length > 0 && (
                      <div className="rounded-lg border border-blue-500/20 bg-blue-950/20 p-3 space-y-1.5">
                        <div className="text-[11px] font-semibold text-blue-300 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-blue-400" />
                          Bài học & Cách áp dụng thực tế:
                        </div>
                        <ul className="space-y-1 text-xs text-slate-300">
                          {item.key_takeaways.map((point: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <span className="text-blue-400 font-bold">•</span>
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Trích dẫn nếu có */}
                    {item.original_quotes && (
                      <div className="text-xs italic text-slate-400 flex items-start gap-1.5 border-l-2 border-slate-700 pl-2.5 py-0.5">
                        <Quote className="h-3.5 w-3.5 shrink-0 text-slate-500 mt-0.5" />
                        <span>"{item.original_quotes}"</span>
                      </div>
                    )}

                    {/* NỘI DUNG THẢO LUẬN GỐC TỪ NHÓM (Accordion xem bản gốc) */}
                    {item.original_content && item.original_content.trim() && (
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleOriginal(item.id)}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/50 transition-colors"
                        >
                          <span className="flex items-center gap-1.5 text-blue-400">
                            <MessageSquare className="h-3.5 w-3.5" />
                            {isExpanded ? "Thu gọn nội dung gốc" : "Xem nội dung thảo luận gốc của tác giả"}
                          </span>
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                        </button>

                        {isExpanded && (
                          <div className="p-3 border-t border-slate-800/80 bg-slate-950 text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                            {item.original_content}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Footer của Card: Nút Xuất Word riêng và Link tham khảo */}
                  <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleExportSingleWord(item.id)}
                        disabled={isExportingThis}
                        className="flex items-center gap-1.5 h-7 px-2.5 text-xs bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white border border-slate-700 transition-all rounded-lg disabled:opacity-50"
                        title="Xuất bài viết này ra file Word (.docx) gồm tóm tắt + nội dung gốc"
                      >
                        <FileText className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                        <span>{isExportingThis ? "Đang xuất..." : "Xuất Word Bài Này"}</span>
                      </button>
                    </div>

                    {item.useful_links && item.useful_links.length > 0 && (
                      <a
                        href={item.useful_links[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
                      >
                        Link đính kèm <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 px-4 py-6 text-center text-xs text-slate-500">
        <p>Hệ thống Quản trị & Chắt lọc Tri thức Tự động • Đồng bộ từ nhóm Telegram</p>
      </footer>
    </div>
  );
}
