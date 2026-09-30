"use client";

import React, { useState, useEffect } from "react";
import {
  BookOpen,
  Download,
  Filter,
  Layers,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Users,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  FileText,
  Clock,
  Tag,
  Quote,
} from "lucide-react";
import { Badge, Card, CardTitle, Button, Input, Stat } from "@/components/ui";

const CATEGORIES = [
  { id: "all", label: "Tất cả", icon: "🌐" },
  { id: "ai_prompt", label: "AI & Prompt", icon: "🤖" },
  { id: "tools_tech", label: "Công Cụ & Tech", icon: "🛠️" },
  { id: "business_real_estate", label: "Kinh Doanh & BĐS", icon: "📈" },
  { id: "tips_workflow", label: "Quy Trình & Tips", icon: "⚡" },
  { id: "news_insight", label: "Tin Tức & Insights", icon: "📰" },
  { id: "general", label: "Khác", icon: "💡" },
];

const TIME_RANGES = [
  { value: "0", label: "Toàn bộ thời gian" },
  { value: "1", label: "24 giờ qua" },
  { value: "7", label: "7 ngày qua" },
  { value: "30", label: "30 ngày qua" },
];

export function TelegramClient() {
  const [activeTab, setActiveTab] = useState<"knowledge" | "chats" | "messages" | "setup">("knowledge");
  const [stats, setStats] = useState<any>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<any[]>([]);
  const [rawMessages, setRawMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Bộ lọc
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedDays, setSelectedDays] = useState("7");
  const [selectedChat, setSelectedChat] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Stats
      const sRes = await fetch("/api/telegram/stats");
      const sData = await sRes.json();
      if (sData.ok) setStats(sData.stats);

      // 2. Chats
      const cRes = await fetch("/api/telegram/chats");
      const cData = await cRes.json();
      if (cData.ok) setChats(cData.chats);

      // 3. Knowledge
      const kParams = new URLSearchParams();
      if (selectedCategory !== "all") kParams.set("category", selectedCategory);
      if (selectedDays !== "0") kParams.set("days", selectedDays);
      if (selectedChat !== "all") kParams.set("chatId", selectedChat);
      if (searchQuery.trim()) kParams.set("search", searchQuery.trim());

      const kRes = await fetch(`/api/telegram/knowledge?${kParams.toString()}`);
      const kData = await kRes.json();
      if (kData.ok) setKnowledgeItems(kData.items || []);

      // 4. Messages (nếu đang ở tab messages)
      if (activeTab === "messages") {
        const mParams = new URLSearchParams();
        if (selectedChat !== "all") mParams.set("chatId", selectedChat);
        mParams.set("limit", "50");
        const mRes = await fetch(`/api/telegram/messages?${mParams.toString()}`);
        const mData = await mRes.json();
        if (mData.ok) setRawMessages(mData.messages || []);
      }
    } catch (err) {
      console.error("Lỗi nạp dữ liệu Telegram:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedCategory, selectedDays, selectedChat, activeTab]);

  const handleToggleChatTracking = async (chatId: string, currentStatus: number) => {
    try {
      const res = await fetch("/api/telegram/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, isTracked: currentStatus === 1 ? 0 : 1 }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchData();
      }
    } catch (err) {
      console.error("Lỗi đổi trạng thái chat:", err);
    }
  };

  const handleExportWord = () => {
    setExporting(true);
    const params = new URLSearchParams();
    if (selectedCategory !== "all") params.set("category", selectedCategory);
    if (selectedDays !== "0") params.set("days", selectedDays);
    if (selectedChat !== "all") params.set("chatId", selectedChat);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());

    // Kích hoạt tải về trực tiếp từ browser
    const url = `/api/telegram/export-word?${params.toString()}`;
    window.location.href = url;
    setTimeout(() => setExporting(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header trang & Nút xuất Word nổi bật */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[var(--color-border)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Send className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">
              Tri Thức & Tài Liệu Telegram
            </h1>
          </div>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Tự động thu thập thảo luận từ các group Telegram, tinh lọc tri thức bằng AI và đóng gói file Word (.docx) chuyên nghiệp
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 h-8 px-3 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Làm mới
          </Button>

          <Button
            onClick={handleExportWord}
            disabled={exporting || knowledgeItems.length === 0}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 font-medium px-4 h-8 text-xs"
          >
            <Download className="h-4 w-4" />
            {exporting ? "Đang tạo file..." : `Xuất File Word (.docx) [${knowledgeItems.length}]`}
          </Button>
        </div>
      </div>

      {/* Thẻ thống kê tổng quan */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Tài Khoản Userbot"
          value={
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${stats?.userbotStatus === "online" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              <span className="text-lg capitalize">{stats?.userbotStatus === "online" ? "Online" : "Sẵn sàng"}</span>
            </div>
          }
          sub={stats?.userbotStatus === "online" ? "Đang lắng nghe nhóm" : "Cần chạy telegram-login"}
        />
        <Stat
          label="Nhóm Đang Theo Dõi"
          value={`${stats?.activeTrackedChats || 0} / ${stats?.totalChats || 0}`}
          sub="Group & Channel Telegram"
        />
        <Stat
          label="Tin Nhắn Đã Quét"
          value={(stats?.totalMessages || 0).toLocaleString()}
          sub="Lưu trữ trong SQLite"
        />
        <Stat
          label="Tri Thức Tinh Lọc"
          value={(stats?.totalKnowledgeItems || 0).toLocaleString()}
          sub="Đã phân loại sẵn sàng xuất Word"
        />
      </div>

      {/* Thanh chuyển Tabs */}
      <div className="flex border-b border-[var(--color-border)]">
        <button
          onClick={() => setActiveTab("knowledge")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "knowledge"
              ? "border-blue-500 text-blue-500"
              : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <Sparkles className="h-4 w-4" />
          Kho Tri Thức ({knowledgeItems.length})
        </button>
        <button
          onClick={() => setActiveTab("chats")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "chats"
              ? "border-blue-500 text-blue-500"
              : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <Users className="h-4 w-4" />
          Nhóm Đang Theo Dõi ({chats.length})
        </button>
        <button
          onClick={() => setActiveTab("messages")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "messages"
              ? "border-blue-500 text-blue-500"
              : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Tin Nhắn Thô
        </button>
        <button
          onClick={() => setActiveTab("setup")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "setup"
              ? "border-blue-500 text-blue-500"
              : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <BookOpen className="h-4 w-4" />
          Hướng Dẫn Kết Nối
        </button>
      </div>

      {/* TAB 1: KHO TRI THỨC */}
      {activeTab === "knowledge" && (
        <div className="space-y-4">
          {/* Thanh lọc chuyên mục & thời gian */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase text-[var(--color-muted)] mr-1">Chủ đề:</span>
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCategory(c.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    selectedCategory === c.id
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  <span>{c.icon}</span>
                  <span>{c.label}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--color-border)]">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Search className="h-4 w-4 text-[var(--color-muted)]" />
                <input
                  type="text"
                  placeholder="Tìm kiếm theo tiêu đề, bài học, giải pháp..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchData()}
                  className="w-full bg-transparent text-xs text-[var(--color-text)] focus:outline-none placeholder:text-[var(--color-muted)]"
                />
              </div>

              <select
                value={selectedDays}
                onChange={(e) => setSelectedDays(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-xs text-[var(--color-text)] focus:outline-none"
              >
                {TIME_RANGES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>

              <select
                value={selectedChat}
                onChange={(e) => setSelectedChat(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-xs text-[var(--color-text)] focus:outline-none max-w-[220px] truncate"
              >
                <option value="all">Tất cả nhóm</option>
                {chats.map((c) => (
                  <option key={c.chat_id} value={c.chat_id}>{c.title}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Danh sách thẻ bài học / tri thức */}
          {knowledgeItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 mb-3">
                <BookOpen className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Chưa có tri thức nào trong khoảng thời gian này</h3>
              <p className="mt-1 text-xs text-[var(--color-muted)] max-w-md mx-auto">
                Khi tài khoản Telegram của anh lắng nghe thảo luận trong các group, AI sẽ tự động phân loại và đưa các bài học giá trị vào đây để xuất Word.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {knowledgeItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm hover:border-blue-500/40 transition-all space-y-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone="default" className="text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {item.category}
                      </Badge>
                      <span className="text-[11px] text-[var(--color-muted)] flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {item.date_range || new Date(item.created_at).toLocaleDateString("vi-VN")}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-[var(--color-text)] leading-snug">
                      {item.title}
                    </h3>

                    <p className="text-xs text-[var(--color-text)]/80 leading-relaxed">
                      {item.summary}
                    </p>

                    {/* Điểm mấu chốt */}
                    {item.key_takeaways && item.key_takeaways.length > 0 && (
                      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-1.5">
                        <div className="text-[11px] font-semibold text-blue-400 flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Điểm mấu chốt & bài học:
                        </div>
                        <ul className="space-y-1 text-[11px] text-[var(--color-text)]/90">
                          {item.key_takeaways.map((point: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <span className="text-blue-400">•</span>
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Trích dẫn */}
                    {item.original_quotes && (
                      <div className="text-[11px] italic text-[var(--color-muted)] flex items-start gap-1.5 border-l-2 border-slate-600 pl-2">
                        <Quote className="h-3 w-3 shrink-0 text-slate-500" />
                        <span>"{item.original_quotes}"</span>
                      </div>
                    )}
                  </div>

                  {/* Footer của Card */}
                  <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-between text-[11px] text-[var(--color-muted)]">
                    <span className="truncate max-w-[200px]" title={item.chat_title}>
                      📍 {item.chat_title || "Group Telegram"}
                    </span>
                    {item.useful_links && item.useful_links.length > 0 && (
                      <a
                        href={item.useful_links[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-blue-400 hover:underline"
                      >
                        Link tham khảo <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: QUẢN LÝ NHÓM */}
      {activeTab === "chats" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 shrink-0">
              <Users className="h-4 w-4" />
            </div>
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-blue-300">Cách đưa nhóm mới vào danh sách theo dõi:</p>
              <p className="text-[var(--color-muted)] leading-relaxed">
                Anh chỉ cần dùng tài khoản Telegram của mình tham gia (join) vào bất kỳ group hoặc channel nào. Userbot sẽ tự động phát hiện và đưa vào bảng này. Anh có thể bật/tắt thu thập cho từng nhóm bằng công tắc bên dưới.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)] uppercase text-[10px] font-semibold tracking-wider">
                <tr>
                  <th className="px-4 py-3">Tên Nhóm / Kênh</th>
                  <th className="px-4 py-3">Loại</th>
                  <th className="px-4 py-3 text-center">Tin Nhắn</th>
                  <th className="px-4 py-3 text-center">Tri Thức Trích Xuất</th>
                  <th className="px-4 py-3 text-right">Trạng Thái Theo Dõi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {chats.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[var(--color-muted)]">
                      Chưa có nhóm nào được ghi nhận. Vui lòng kết nối tài khoản Telegram trước.
                    </td>
                  </tr>
                ) : (
                  chats.map((c) => (
                    <tr key={c.chat_id} className="hover:bg-[var(--color-surface-2)]/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-[var(--color-text)]">
                        <div className="flex flex-col">
                          <span>{c.title}</span>
                          {c.username && <span className="text-[10px] text-[var(--color-muted)]">@{c.username}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-muted)] uppercase text-[10px]">
                        {c.chat_type || "group"}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-[var(--color-text)]">
                        {(c.message_count || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-blue-400">
                        {(c.knowledge_count || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleToggleChatTracking(c.chat_id, c.is_tracked)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            c.is_tracked === 1
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
                              : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                          }`}
                        >
                          {c.is_tracked === 1 ? "✓ Đang theo dõi" : "Tạm dừng"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: DÒNG TIN NHẮN THÔ */}
      {activeTab === "messages" && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)]">
            <h3 className="text-xs font-semibold uppercase text-[var(--color-muted)]">
              Nhật ký tin nhắn vừa nhận từ các nhóm
            </h3>
            <span className="text-[11px] text-[var(--color-muted)]">50 tin mới nhất</span>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
            {rawMessages.length === 0 ? (
              <p className="text-center py-8 text-xs text-[var(--color-muted)]">Chưa có tin nhắn thô nào trong database.</p>
            ) : (
              rawMessages.map((m) => (
                <div key={m.id} className="rounded-lg bg-[var(--color-surface-2)] p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-[var(--color-muted)]">
                    <span className="font-semibold text-blue-400">{m.sender_name || m.sender_username || "Thành viên"}</span>
                    <span>{new Date(m.date * 1000).toLocaleString("vi-VN")}</span>
                  </div>
                  <p className="text-[var(--color-text)] whitespace-pre-wrap">{m.message_text}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: HƯỚNG DẪN KẾT NỐI TÀI KHOẢN */}
      {activeTab === "setup" && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-6">
          <div className="space-y-2">
            <h3 className="text-base font-bold text-[var(--color-text)] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 text-xs">1</span>
              Lấy API ID & API HASH từ Telegram (Chỉ mất 1 phút)
            </h3>
            <div className="pl-8 text-xs text-[var(--color-muted)] space-y-1.5 leading-relaxed">
              <p>1. Truy cập trang web chính thức của Telegram: <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="text-blue-400 underline font-medium">https://my.telegram.org</a></p>
              <p>2. Đăng nhập bằng số điện thoại Telegram của anh (nhập mã xác nhận gửi về ứng dụng Telegram).</p>
              <p>3. Chọn mục <strong>API development tools</strong>.</p>
              <p>4. Điền App title và Short name (tùy ý, ví dụ: <code>MyCollector</code>) rồi bấm Create.</p>
              <p>5. Sao chép 2 thông số: <strong>App api_id</strong> (dãy số) và <strong>App api_hash</strong> (dãy ký tự).</p>
            </div>
          </div>

          <div className="space-y-2 border-t border-[var(--color-border)] pt-4">
            <h3 className="text-base font-bold text-[var(--color-text)] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 text-xs">2</span>
              Kích hoạt đăng nhập Userbot trên VPS
            </h3>
            <div className="pl-8 text-xs text-[var(--color-muted)] space-y-2 leading-relaxed">
              <p>Chỉ cần chạy lệnh sau trên terminal của VPS (hoặc nhắn em chạy giúp anh):</p>
              <div className="rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-emerald-400 border border-slate-800">
                cd ~/zalo-bot-2/bot && npm run telegram-login
              </div>
              <p>Terminal sẽ hỏi số điện thoại và mã OTP gửi về Telegram. Nhập xong là hệ thống tự động lưu vĩnh viễn, bot sẽ tự động online và kéo tin tức thì!</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
