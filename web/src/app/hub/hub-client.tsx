"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  Search,
  BookOpen,
  Link as LinkIcon,
  ExternalLink,
  Copy,
  Check,
  Tag,
  Share2,
  Users,
  Flame,
  Layers,
  ArrowUpRight,
  ArrowRight,
  Bookmark,
  Calendar,
  FolderDown,
  Download,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Lock,
  ShieldCheck,
  Layers2,
  Globe,
  SlidersHorizontal,
} from "lucide-react";

interface KnowledgeItem {
  id: string;
  title: string;
  category: "ai" | "mmo" | "learning" | "links" | "announcement" | "general";
  categoryLabel: string;
  summary: string;
  keyPoints: string[];
  links: { url: string; label?: string; isFile?: boolean }[];
  author: string;
  date: string;
  timestamp: number;
  source: "summary" | "message";
  groupId?: string;
  groupName?: string;
}

interface GroupInfo {
  id: string;
  name: string;
  totalMembers: number;
  token: string;
}

interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

const CATEGORIES = [
  { id: "all", label: "Tất cả", icon: Layers },
  { id: "ai", label: "🤖 AI & Video", icon: Sparkles },
  { id: "mmo", label: "💼 MMO & Tut Mẹo", icon: Flame },
  { id: "files", label: "📂 File & Tài liệu Drive", icon: FolderDown },
  { id: "links", label: "🔗 Link & Công cụ", icon: LinkIcon },
];

const SORT_OPTIONS = [
  { id: "newest", label: "🕒 Mới nhất" },
  { id: "oldest", label: "⏳ Cũ nhất" },
  { id: "author_asc", label: "👤 Người chia sẻ (A → Z)" },
  { id: "author_desc", label: "👤 Người chia sẻ (Z → A)" },
  { id: "title_asc", label: "🔤 Tên tài nguyên (A → Z)" },
];

export function HubClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Đọc params từ URL ban đầu
  const initialGroupId = searchParams.get("groupId") || searchParams.get("group") || "all";
  const urlToken = searchParams.get("token") || "";

  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedSort, setSelectedSort] = useState("newest");
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [isLockedGroup, setIsLockedGroup] = useState(false);
  const [currentGroup, setCurrentGroup] = useState<GroupInfo | null>(null);

  // Phân trang
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 18,
    totalItems: 0,
    totalPages: 1,
  });

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedGroupLink, setCopiedGroupLink] = useState(false);
  const [stats, setStats] = useState({ totalItems: 0, totalLinks: 0, totalFiles: 0, totalContributors: 0 });
  const [savedItemIds, setSavedItemIds] = useState<string[]>([]);
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);
  const [unauthorizedError, setUnauthorizedError] = useState<string | null>(null);

  // Load saved bookmarks from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("saved_hub_items");
      if (saved) setSavedItemIds(JSON.parse(saved));
    } catch {}
  }, []);

  // Debounce search input (450ms giúp gõ êm mượt không spam server)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
      setPagination((prev) => ({ ...prev, page: 1 }));
    }, 450);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Hàm tải dữ liệu từ API
  const fetchData = useCallback(
    async (pageToLoad: number, limitToLoad: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(pageToLoad));
        params.set("limit", String(limitToLoad));
        params.set("category", selectedCategory);
        params.set("sort", selectedSort);

        if (selectedGroupId && selectedGroupId !== "all") {
          params.set("groupId", selectedGroupId);
        }
        if (urlToken) {
          params.set("token", urlToken);
        }
        if (debouncedQuery) {
          params.set("q", debouncedQuery);
        }

        const res = await fetch(`/api/hub?${params.toString()}`);
        if (res.status === 401) {
          const errData = await res.json().catch(() => ({}));
          setUnauthorizedError(errData.message || "Kho tài nguyên này chỉ dành cho Quản trị viên.");
          setLoading(false);
          return;
        }

        if (res.ok) {
          setUnauthorizedError(null);
          const data = await res.json();
          setItems(data.items || []);
          if (data.pagination) setPagination(data.pagination);
          if (data.stats) setStats(data.stats);
          if (data.groups) setGroups(data.groups);
          if (typeof data.isLockedGroup === "boolean") {
            setIsLockedGroup(data.isLockedGroup);
          }
          if (data.currentGroup) {
            setCurrentGroup(data.currentGroup);
          }
        }
      } catch (e) {
        console.error("Lỗi tải kho tài nguyên:", e);
      } finally {
        setLoading(false);
      }
    },
    [selectedCategory, selectedSort, selectedGroupId, urlToken, debouncedQuery]
  );

  // Gọi API mỗi khi filter/sort/group thay đổi
  useEffect(() => {
    fetchData(pagination.page, pagination.limit);
  }, [fetchData, pagination.page, pagination.limit]);

  // Xử lý đổi trang
  function handlePageChange(newPage: number) {
    if (newPage < 1 || newPage > pagination.totalPages || newPage === pagination.page) return;
    setPagination((prev) => ({ ...prev, page: newPage }));
    window.scrollTo({ top: 380, behavior: "smooth" });
  }

  // Xử lý đổi số item mỗi trang
  function handleLimitChange(newLimit: number) {
    setPagination((prev) => ({ ...prev, limit: newLimit, page: 1 }));
  }

  // Xử lý đổi nhóm
  function handleGroupChange(newGroupId: string) {
    setSelectedGroupId(newGroupId);
    setPagination((prev) => ({ ...prev, page: 1 }));
  }

  // Xử lý đổi sắp xếp
  function handleSortChange(newSort: string) {
    setSelectedSort(newSort);
    setPagination((prev) => ({ ...prev, page: 1 }));
  }

  // Sao chép link chia sẻ bảo mật cho nhóm
  function handleCopyGroupShareLink() {
    if (!selectedGroupId || selectedGroupId === "all") return;
    const currentG = groups.find((g) => g.id === selectedGroupId) || currentGroup;
    if (!currentG || !currentG.token) return;

    const shareUrl = `${window.location.origin}/hub?groupId=${currentG.id}&token=${currentG.token}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedGroupLink(true);
    setTimeout(() => setCopiedGroupLink(false), 2500);
  }

  function toggleSave(id: string) {
    const updated = savedItemIds.includes(id)
      ? savedItemIds.filter((item) => item !== id)
      : [...savedItemIds, id];
    setSavedItemIds(updated);
    try {
      localStorage.setItem("saved_hub_items", JSON.stringify(updated));
    } catch {}
  }

  function handleCopy(item: KnowledgeItem) {
    const content = `${item.title}\n\n${item.keyPoints.map((kp) => `- ${kp}`).join("\n")}${
      item.links.length > 0 ? `\n\nLink đính kèm:\n${item.links.map((l) => l.url).join("\n")}` : ""
    }\n\nNguồn: ${item.groupName || "Cộng đồng Zalo"} (${item.date})`;
    navigator.clipboard.writeText(content);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Tạo danh sách số trang hiển thị thông minh
  const pageNumbers = useMemo(() => {
    const total = pagination.totalPages;
    const current = pagination.page;
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages: (number | string)[] = [];
    pages.push(1);
    if (current > 3) pages.push("...");
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    if (current < total - 2) pages.push("...");
    pages.push(total);
    return pages;
  }, [pagination.totalPages, pagination.page]);

  if (unauthorizedError) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
        <div className="relative overflow-hidden w-full max-w-lg rounded-2xl border border-rose-500/30 bg-gradient-to-b from-slate-900 via-slate-900/90 to-slate-950 p-8 shadow-2xl backdrop-blur-xl text-center space-y-6">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-rose-500/10 border border-rose-500/30 text-rose-400 shadow-inner">
            <Lock className="h-10 w-10 text-rose-400" />
          </div>

          <div className="space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Khu Vực Được Bảo Vệ</span>
            </span>
            <h2 className="text-2xl font-bold text-white tracking-tight">Yêu Cầu Quyền Truy Cập</h2>
            <p className="text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
              {unauthorizedError}
            </p>
            <p className="text-xs text-slate-400 leading-relaxed bg-slate-950/80 p-3 rounded-xl border border-slate-800">
              💡 <strong>Dành cho thành viên:</strong> Vui lòng sử dụng đường link chia sẻ bảo mật do Trưởng nhóm Zalo cung cấp để vào thẳng kho tài nguyên của nhóm mình.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 w-full sm:w-auto rounded-xl bg-cyan-500 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
            >
              <span>Đăng Nhập Quản Trị Viên</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-8 pb-16 text-slate-100">
      {/* 🌟 HERO BANNER & STATS */}
      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900 via-slate-900/90 to-cyan-950/40 p-6 md:p-10 shadow-2xl backdrop-blur-xl">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-16 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" />
              <span>AI Knowledge & Resource Hub</span>
            </div>

            {/* Chế độ nhóm bị khóa (Member access mode) */}
            {isLockedGroup && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Kho tài nguyên: {currentGroup?.name || "Nhóm riêng"}</span>
              </div>
            )}
          </div>



          {/* Stat Badges */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <div className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-3.5 py-1.5 border border-slate-700/60 text-xs font-medium text-slate-200">
              <BookOpen className="h-4 w-4 text-cyan-400" />
              <span>
                <strong className="text-cyan-300">{stats.totalItems || pagination.totalItems}</strong> bài đúc kết
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-3.5 py-1.5 border border-slate-700/60 text-xs font-medium text-slate-200">
              <FolderDown className="h-4 w-4 text-amber-400" />
              <span>
                <strong className="text-amber-300">{stats.totalFiles}</strong> file & Drive
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-3.5 py-1.5 border border-slate-700/60 text-xs font-medium text-slate-200">
              <LinkIcon className="h-4 w-4 text-emerald-400" />
              <span>
                <strong className="text-emerald-300">{stats.totalLinks}</strong> link công cụ
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-3.5 py-1.5 border border-slate-700/60 text-xs font-medium text-slate-200">
              <Users className="h-4 w-4 text-purple-400" />
              <span>
                <strong className="text-purple-300">{stats.totalContributors}</strong> thành viên chia sẻ
              </span>
            </div>
          </div>
        </div>

        {/* 🔍 SEARCH BAR & GROUP SELECTION BAR */}
        <div className="relative z-10 mt-6 space-y-4">
          <div className="relative flex items-center max-w-2xl">
            <Search className="absolute left-4 h-5 w-5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên thành viên, link url, hoặc chủ đề (ví dụ: Hoàng, Drive, Canva, Adsense...)"
              className="w-full rounded-xl border border-slate-700/80 bg-slate-950/80 py-3.5 pl-12 pr-10 text-sm text-white placeholder-slate-400 shadow-inner outline-none transition-all focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 backdrop-blur-md"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 rounded-md px-2 py-1 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          {/* CHỌN NHÓM & NÚT COPY LINK CHIA SẺ (Chỉ hiển thị khi KHÔNG ở chế độ khóa nhóm) */}
          {!isLockedGroup && groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <div className="flex items-center gap-2 rounded-xl bg-slate-950/60 p-1.5 border border-slate-800">
                <Users className="h-4 w-4 text-cyan-400 ml-2 shrink-0" />
                <span className="text-xs font-medium text-slate-400">Xem theo nhóm:</span>
                <select
                  value={selectedGroupId}
                  onChange={(e) => handleGroupChange(e.target.value)}
                  aria-label="Chọn nhóm Zalo"
                  className="bg-slate-900 text-xs font-medium text-cyan-300 rounded-lg px-3 py-1.5 border border-slate-700 outline-none cursor-pointer hover:border-cyan-500 transition-colors"
                >
                  <option value="all">🌐 Tất cả các nhóm ({stats.totalItems} mục)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      📌 {g.name} {g.totalMembers ? `(${g.totalMembers} tv)` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Nút Copy Link Chia Sẻ Nhóm Riêng */}
              {selectedGroupId !== "all" && (
                <button
                  onClick={handleCopyGroupShareLink}
                  className="flex items-center gap-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 px-3.5 py-2 text-xs font-semibold text-cyan-300 transition-all shadow-sm"
                  title="Sao chép link độc quyền chỉ dành riêng cho thành viên nhóm này"
                >
                  {copiedGroupLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Share2 className="h-3.5 w-3.5 text-cyan-400" />}
                  <span>{copiedGroupLink ? "Đã sao chép link bảo mật!" : "Copy link chia sẻ cho nhóm này"}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 🏷️ CATEGORY TABS & SORT BAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        {/* Category Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs md:text-sm font-medium transition-all ${
                  active
                    ? "bg-cyan-500 text-slate-950 font-semibold shadow-lg shadow-cyan-500/20"
                    : "bg-slate-900/60 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Sort Selector & Limit Selector */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-slate-900/80 px-3 py-1.5 border border-slate-800 text-xs">
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-400">Sắp xếp:</span>
            <select
              value={selectedSort}
              onChange={(e) => handleSortChange(e.target.value)}
              aria-label="Sắp xếp danh sách tài nguyên"
              className="bg-transparent text-cyan-300 font-medium outline-none cursor-pointer"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-slate-900 text-slate-200">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-2.5 py-1.5 border border-slate-800 text-xs">
            <span className="text-slate-400">Hiển thị:</span>
            <select
              value={pagination.limit}
              onChange={(e) => handleLimitChange(Number(e.target.value))}
              aria-label="Số lượng tài nguyên hiển thị mỗi trang"
              className="bg-transparent text-slate-200 font-medium outline-none cursor-pointer"
            >
              <option value={12} className="bg-slate-900">12 / trang</option>
              <option value={18} className="bg-slate-900">18 / trang</option>
              <option value={36} className="bg-slate-900">36 / trang</option>
            </select>
          </div>
        </div>
      </div>

      {/* 📚 KNOWLEDGE CARDS GRID */}
      {loading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-64 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40 p-5"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-12 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-slate-200">Không tìm thấy tài nguyên phù hợp</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Thử tìm kiếm với từ khóa khác, chuyển danh mục hoặc đổi sang nhóm khác để khám phá thêm nhé.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const isSaved = savedItemIds.includes(item.id);
            const isCopied = copiedId === item.id;

            return (
              <div
                key={item.id}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/70 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-cyan-500/40 hover:shadow-xl hover:shadow-cyan-500/5 backdrop-blur-sm"
              >
                <div>
                  {/* Top Bar: Category & Group Name & Date */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        item.category === "ai"
                          ? "bg-purple-500/10 text-purple-300 border border-purple-500/20"
                          : item.category === "mmo"
                          ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                          : item.category === "learning"
                          ? "bg-blue-500/10 text-blue-300 border border-blue-500/20"
                          : item.category === "links"
                          ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                          : "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                      }`}
                    >
                      <Tag className="h-3 w-3" />
                      {item.categoryLabel}
                    </span>

                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>{item.date}</span>
                    </div>
                  </div>

                  {/* Title - Click to open modal */}
                  <h3
                    onClick={() => setSelectedItem(item)}
                    className="mt-3 text-base font-semibold text-white leading-snug group-hover:text-cyan-300 transition-colors cursor-pointer hover:underline break-words break-all [overflow-wrap:anywhere] min-w-0"
                    title="Bấm để xem chi tiết nội dung"
                  >
                    {item.title}
                  </h3>

                  {/* Group Tag if viewing all groups */}
                  {!isLockedGroup && item.groupName && (
                    <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-400 bg-slate-950/60 px-2 py-0.5 rounded border border-slate-800 max-w-full truncate">
                      <Users className="h-3 w-3 text-cyan-400 shrink-0" />
                      <span className="truncate">{item.groupName}</span>
                    </div>
                  )}

                  {/* Key Points */}
                  <div className="mt-3 space-y-2 text-xs text-slate-300 leading-relaxed min-w-0">
                    {item.keyPoints.slice(0, 3).map((point, idx) => (
                      <div key={idx} className="flex items-start gap-2 min-w-0">
                        <span className="text-cyan-400 font-bold shrink-0">•</span>
                        <p className="line-clamp-2 break-words break-all [overflow-wrap:anywhere] min-w-0">{point}</p>
                      </div>
                    ))}
                    {item.keyPoints.length > 3 && (
                      <button
                        onClick={() => setSelectedItem(item)}
                        className="text-xs font-medium text-cyan-400 hover:underline pt-1 inline-block"
                      >
                        + Xem thêm {item.keyPoints.length - 3} ý chi tiết...
                      </button>
                    )}
                  </div>

                  {/* Links & Files attached */}
                  {item.links.length > 0 && (
                    <div className="mt-4 space-y-2 rounded-lg bg-slate-950/60 p-3 border border-slate-800 min-w-0">
                      <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5">
                        {item.links.some((l) => l.isFile) ? (
                          <>
                            <FolderDown className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            <span className="text-amber-300">File & Tài liệu đính kèm:</span>
                          </>
                        ) : (
                          <>
                            <LinkIcon className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            <span>Tài nguyên & Link:</span>
                          </>
                        )}
                      </span>
                      {item.links.map((l, idx) => (
                        <a
                          key={idx}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center justify-between gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors min-w-0 ${
                            l.isFile
                              ? "bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20"
                              : "bg-slate-900/80 text-cyan-300 border border-slate-700/60 hover:bg-slate-800 hover:text-cyan-200"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                            {l.isFile ? (
                              <Download className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                            ) : (
                              <ExternalLink className="h-3 w-3 shrink-0 text-cyan-400" />
                            )}
                            <span className="truncate break-all min-w-0">{l.url}</span>
                          </div>
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider opacity-80 ml-1">
                            {l.isFile ? "Tải File" : "Mở"}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer: Author & Actions */}
                <div className="mt-5 flex items-center justify-between border-t border-slate-800/60 pt-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <div className="h-5 w-5 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-bold text-[10px]">
                      {item.author.charAt(0).toUpperCase()}
                    </div>
                    <span className="truncate max-w-[120px]">{item.author}</span>
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleSave(item.id)}
                      title="Lưu bài viết"
                      className={`rounded-md p-1.5 transition-colors ${
                        isSaved
                          ? "bg-amber-500/10 text-amber-400"
                          : "text-slate-400 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      <Bookmark className={`h-4 w-4 ${isSaved ? "fill-amber-400" : ""}`} />
                    </button>

                    <button
                      onClick={() => handleCopy(item)}
                      title="Sao chép nội dung"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                    >
                      {isCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>

                    <button
                      onClick={() => setSelectedItem(item)}
                      title="Xem toàn bộ"
                      className="rounded-md p-1.5 text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                    >
                      <ArrowUpRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 📄 THANH PHÂN TRANG (PAGINATION BAR) */}
      {!loading && pagination.totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur-md">
          <div className="text-xs text-slate-400">
            Hiển thị{" "}
            <strong className="text-cyan-300">
              {(pagination.page - 1) * pagination.limit + 1} -{" "}
              {Math.min(pagination.page * pagination.limit, pagination.totalItems)}
            </strong>{" "}
            trên tổng số <strong className="text-white">{pagination.totalItems}</strong> tài nguyên
          </div>

          <div className="flex items-center gap-1.5">
            {/* Nút Trang Trước */}
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                pagination.page <= 1
                  ? "bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed"
                  : "bg-slate-800 text-slate-200 hover:bg-cyan-500 hover:text-slate-950 border border-slate-700"
              }`}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Trước</span>
            </button>

            {/* Các nút số trang */}
            {pageNumbers.map((p, idx) => {
              if (p === "...") {
                return (
                  <span key={`dots-${idx}`} className="px-2 text-xs text-slate-500 font-bold">
                    ...
                  </span>
                );
              }
              const isCurrent = p === pagination.page;
              return (
                <button
                  key={p}
                  onClick={() => handlePageChange(Number(p))}
                  className={`min-w-[32px] h-8 rounded-lg px-2 text-xs font-medium transition-all ${
                    isCurrent
                      ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20"
                      : "bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700/60"
                  }`}
                >
                  {p}
                </button>
              );
            })}

            {/* Nút Trang Sau */}
            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                pagination.page >= pagination.totalPages
                  ? "bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed"
                  : "bg-slate-800 text-slate-200 hover:bg-cyan-500 hover:text-slate-950 border border-slate-700"
              }`}
            >
              <span>Sau</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 📄 MODAL XEM CHI TIẾT BÀI VIẾT */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-cyan-500/30 bg-slate-900 p-6 md:p-8 shadow-2xl space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-0.5 text-xs text-cyan-300">
                    <Tag className="h-3 w-3" />
                    {selectedItem.categoryLabel}
                  </span>
                  {selectedItem.groupName && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">
                      <Users className="h-3 w-3 text-cyan-400" />
                      {selectedItem.groupName}
                    </span>
                  )}
                </div>
                <h2 className="text-lg md:text-xl font-bold text-white leading-snug break-words break-all [overflow-wrap:anywhere] max-w-full">
                  {selectedItem.title}
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Được đúc kết ngày {selectedItem.date} · Chia sẻ bởi {selectedItem.author}
                </p>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="rounded-lg bg-slate-800 p-2 text-slate-400 hover:text-white hover:bg-slate-700 shrink-0"
              >
                ✕
              </button>
            </div>

            {/* Chi tiết nội dung */}
            <div className="space-y-3 text-sm text-slate-200 leading-relaxed min-w-0">
              <h4 className="font-semibold text-cyan-300 text-xs uppercase tracking-wider">
                Nội Dung Chi Tiết & Hướng Dẫn:
              </h4>
              <div className="space-y-3 rounded-xl bg-slate-950/70 p-4 md:p-5 border border-slate-800 min-w-0 overflow-hidden">
                {selectedItem.keyPoints.map((kp, idx) => {
                  const isStep = /^(—\s*bước|bước|buoc|step|\d+\.)/i.test(kp);
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 min-w-0 ${
                        isStep ? "p-2.5 rounded-lg bg-slate-900/90 border border-slate-800" : ""
                      }`}
                    >
                      <span className="text-cyan-400 font-bold mt-0.5 text-sm shrink-0">
                        {isStep ? "📍" : "•"}
                      </span>
                      <p className="text-slate-200 leading-relaxed break-words break-all [overflow-wrap:anywhere] whitespace-pre-wrap flex-1 min-w-0">
                        {kp}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Link & File đính kèm */}
            {selectedItem.links.length > 0 && (
              <div className="space-y-2 pt-2 min-w-0">
                <h4 className="font-semibold text-emerald-400 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  {selectedItem.links.some((l) => l.isFile) ? (
                    <>
                      <FolderDown className="h-4 w-4 text-amber-400 shrink-0" />
                      <span className="text-amber-300">File & Tài liệu đính kèm:</span>
                    </>
                  ) : (
                    <>
                      <LinkIcon className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>Đường link & Tài nguyên:</span>
                    </>
                  )}
                </h4>
                <div className="space-y-2 min-w-0">
                  {selectedItem.links.map((l, idx) => (
                    <a
                      key={idx}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-between rounded-lg p-3 text-xs transition-colors min-w-0 ${
                        l.isFile
                          ? "border border-amber-500/30 bg-amber-950/20 text-amber-300 hover:bg-amber-950/40"
                          : "border border-emerald-500/20 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                        {l.isFile ? <Download className="h-4 w-4 text-amber-400 shrink-0" /> : <ExternalLink className="h-4 w-4 shrink-0" />}
                        <span className="truncate break-all min-w-0 flex-1">{l.url}</span>
                      </div>
                      <span className="text-[11px] font-bold uppercase shrink-0 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 ml-1">
                        {l.isFile ? "Tải File / Mở Drive" : "Mở Link"}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                onClick={() => handleCopy(selectedItem)}
                className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700 transition-colors"
              >
                {copiedId === selectedItem.id ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copiedId === selectedItem.id ? "Đã sao chép" : "Sao chép toàn bộ"}
              </button>
              <button
                onClick={() => setSelectedItem(null)}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
