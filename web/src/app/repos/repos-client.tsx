"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search,
  ExternalLink,
  Copy,
  Check,
  Star,
  GitFork,
  Code2,
  FolderGit2,
  Sparkles,
  Layers,
  Users,
  Clock,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  Share2,
  ShieldCheck,
  Zap,
  Building2,
} from "lucide-react";

export interface GroupRepo {
  id: number;
  thread_id: string;
  repo_url: string;
  owner: string;
  repo_name: string;
  full_name: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  category: string;
  summary_vi: string;
  target_audience: string;
  shared_by_uid: string;
  shared_by_name: string;
  group_name?: string;
  created_at: number;
  updated_at: number;
}

interface GroupInfo {
  id: string;
  name: string;
  repoCount: number;
  token: string;
}

interface CategoryCount {
  category: string;
  count: number;
}

const TAXONOMY = [
  { id: "all", label: "Tất cả", emoji: "🌐" },
  { id: "🤖 AI & Agents", label: "AI & Agents", emoji: "🤖" },
  { id: "🔌 MCP & Skills", label: "MCP & Skills", emoji: "🔌" },
  { id: "🛠️ Dev Tools & CLI", label: "Dev Tools & CLI", emoji: "🛠️" },
  { id: "🕷️ Automation & Scraping", label: "Automation & Scraping", emoji: "🕷️" },
  { id: "🌐 Web & Fullstack", label: "Web & Fullstack", emoji: "💻" },
  { id: "🏠 Self-Hosted & Infra", label: "Self-Hosted & Infra", emoji: "🏠" },
  { id: "📦 Libraries & Core", label: "Libraries & Core", emoji: "📦" },
];

function getLanguageColor(lang: string): string {
  const map: Record<string, string> = {
    python: "bg-blue-400",
    typescript: "bg-blue-600",
    javascript: "bg-yellow-400",
    rust: "bg-orange-500",
    go: "bg-cyan-400",
    cpp: "bg-rose-500",
    "c++": "bg-rose-500",
    c: "bg-slate-400",
    java: "bg-amber-600",
    php: "bg-indigo-400",
    ruby: "bg-red-500",
    swift: "bg-orange-400",
    kotlin: "bg-violet-500",
    html: "bg-orange-600",
    css: "bg-sky-400",
    shell: "bg-emerald-400",
  };
  return map[lang.toLowerCase()] || "bg-cyan-500";
}

function formatStarCount(stars: number): string {
  if (!stars) return "0";
  if (stars >= 1000) {
    return `${(stars / 1000).toFixed(1)}k`;
  }
  return stars.toLocaleString();
}

function timeAgo(timestamp: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return new Date(timestamp).toLocaleDateString("vi-VN");
}

export function ReposClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialCategory = searchParams.get("category") || "all";
  const initialGroupId = searchParams.get("groupId") || searchParams.get("group") || "all";
  const urlToken = searchParams.get("token") || "";

  const [repos, setRepos] = useState<GroupRepo[]>([]);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [isLockedGroup, setIsLockedGroup] = useState(false);
  const [currentGroup, setCurrentGroup] = useState<GroupInfo | null>(null);

  const [stats, setStats] = useState({ totalRepos: 0, totalStars: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [selectedSort, setSelectedSort] = useState("stars");
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId);

  const [pagination, setPagination] = useState({
    page: 1,
    limit: 24,
    total: 0,
    totalPages: 1,
  });

  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copiedGroupLink, setCopiedGroupLink] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPagination((p) => ({ ...p, page: 1 }));
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchRepos = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedGroupId && selectedGroupId !== "all") params.set("groupId", selectedGroupId);
      if (urlToken) params.set("token", urlToken);
      if (selectedCategory && selectedCategory !== "all") params.set("category", selectedCategory);
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (selectedSort) params.set("sort", selectedSort);
      params.set("page", String(page));
      params.set("limit", "24");

      const res = await fetch(`/api/repos?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRepos(data.repos || []);
        setCategories(data.categories || []);
        setGroups(data.groups || []);
        if (typeof data.isLockedGroup === "boolean") setIsLockedGroup(data.isLockedGroup);
        if (data.currentGroup) setCurrentGroup(data.currentGroup);
        if (data.pagination) setPagination(data.pagination);
        if (data.stats) setStats(data.stats);
      }
    } catch (err) {
      console.error("Lỗi khi tải repos:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedGroupId, urlToken, selectedCategory, debouncedQuery, selectedSort]);

  useEffect(() => {
    fetchRepos(pagination.page);
  }, [fetchRepos, pagination.page]);

  function handleCopy(url: string) {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  }

  function handleCopyGroupShareLink() {
    const g = groups.find((grp) => grp.id === selectedGroupId) || currentGroup;
    if (!g) return;
    const shareUrl = `${window.location.origin}/repos?groupId=${g.id}&token=${g.token}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedGroupLink(true);
    setTimeout(() => setCopiedGroupLink(false), 2500);
  }

  async function handleSyncHistoricRepos() {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const qs = selectedGroupId && selectedGroupId !== "all" ? `?groupId=${selectedGroupId}` : "";
      const res = await fetch(`/api/repos/sync${qs}`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncMessage(data.message || `Đồng bộ thành công! Thêm ${data.newReposFound} repo mới.`);
        await fetchRepos(1);
      } else {
        setSyncMessage(`Lỗi đồng bộ: ${data.error || "Thất bại"}`);
      }
    } catch (err: any) {
      setSyncMessage(`Lỗi mạng: ${err.message}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(null), 6000);
    }
  }

  // Tính count theo category từ API
  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of categories) {
      map.set(c.category, c.count);
    }
    return map;
  }, [categories]);

  const activeGroupName = useMemo(() => {
    if (isLockedGroup && currentGroup) return currentGroup.name;
    if (selectedGroupId === "all") return "Tất cả các nhóm";
    const found = groups.find((g) => g.id === selectedGroupId);
    return found?.name || "Nhóm đã chọn";
  }, [isLockedGroup, currentGroup, selectedGroupId, groups]);

  return (
    <div className="min-h-screen space-y-8 pb-20 text-slate-100">
      {/* 🌟 HERO BANNER & STATS */}
      <div className="relative overflow-hidden rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-slate-900 via-slate-900/95 to-indigo-950/40 p-6 md:p-10 shadow-2xl backdrop-blur-xl">
        <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-16 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
              <FolderGit2 className="h-3.5 w-3.5" />
              <span>FindARepo • Zalo Community Edition</span>
            </div>

            {/* Chế độ nhóm bị khóa bảo mật */}
            {isLockedGroup && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Kho Repo: {currentGroup?.name || "Nhóm riêng"}</span>
              </div>
            )}

            <span className="text-xs text-slate-400">Tự động phân loại & đúc kết bằng AI</span>
          </div>

          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-white">
            Kho GitHub Repositories Tuyển Chọn
          </h1>

          <p className="text-sm md:text-base text-slate-300 leading-relaxed max-w-2xl">
            Tất cả công cụ, thư viện mã nguồn mở và Agent AI được các thành viên chia sẻ trong các nhóm Zalo — được bóc tách metadata, chấm sao và tóm tắt công năng chuẩn xác theo chuẩn FindARepo.
          </p>

          {/* Stats Bar */}
          <div className="flex flex-wrap items-center gap-3 pt-3">
            <div className="flex items-center gap-2 rounded-xl bg-slate-800/80 px-4 py-2 border border-slate-700/60 text-xs font-medium text-slate-200 shadow-sm">
              <Code2 className="h-4 w-4 text-indigo-400" />
              <span>
                <strong className="text-indigo-300 font-bold">{stats.totalRepos || pagination.total}</strong> repos ({activeGroupName})
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-xl bg-slate-800/80 px-4 py-2 border border-slate-700/60 text-xs font-medium text-slate-200 shadow-sm">
              <Star className="h-4 w-4 text-amber-400 fill-amber-400/20" />
              <span>
                <strong className="text-amber-300 font-bold">{formatStarCount(stats.totalStars)}</strong> tổng stars
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-xl bg-slate-800/80 px-4 py-2 border border-slate-700/60 text-xs font-medium text-slate-200 shadow-sm">
              <Building2 className="h-4 w-4 text-purple-400" />
              <span>
                <strong className="text-purple-300 font-bold">{groups.length}</strong> nhóm Zalo kết nối
              </span>
            </div>

            <Link
              href="/hub"
              className="ml-auto inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
            >
              <span>Về Kho Kiến Thức</span>
              <span>→</span>
            </Link>
          </div>
        </div>

        {/* 🏢 GROUP SELECTION BAR & SYNC BUTTON */}
        {!isLockedGroup && groups.length > 0 && (
          <div className="relative z-10 mt-6 flex flex-wrap items-center gap-3 p-3 rounded-2xl bg-slate-950/70 border border-slate-800/90 backdrop-blur-md">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
              <Building2 className="h-4 w-4 text-indigo-400" />
              <span>Lọc theo nhóm Zalo:</span>
            </div>

            <select
              value={selectedGroupId}
              onChange={(e) => {
                setSelectedGroupId(e.target.value);
                setPagination((p) => ({ ...p, page: 1 }));
              }}
              aria-label="Chọn nhóm Zalo cần xem repo"
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-indigo-500 cursor-pointer max-w-[260px] truncate"
            >
              <option value="all">🌐 Tất cả các nhóm ({groups.reduce((acc, g) => acc + g.repoCount, 0)} repos)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.repoCount} repos)
                </option>
              ))}
            </select>

            {/* Nút Copy Link Chia Sẻ Nhóm (kèm Token an toàn cho thành viên) */}
            {selectedGroupId !== "all" && (
              <button
                onClick={handleCopyGroupShareLink}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-3 py-2 text-xs font-bold text-indigo-300 hover:bg-indigo-500/25 transition-all shadow-sm"
              >
                {copiedGroupLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Share2 className="h-3.5 w-3.5" />}
                <span>{copiedGroupLink ? "Đã chép link bảo mật!" : "Copy link chia sẻ cho nhóm này"}</span>
              </button>
            )}

            {/* Nút Đồng Bộ Lịch Sử Repos Trong Nhóm */}
            <button
              onClick={handleSyncHistoricRepos}
              disabled={syncing}
              title="Quét lại tất cả tin nhắn cũ trong nhóm để bóc tách link GitHub đã gửi trước đây"
              className="ml-auto flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <Zap className={`h-3.5 w-3.5 ${syncing ? "animate-spin text-emerald-400" : ""}`} />
              <span>{syncing ? "Đang quét tin nhắn cũ..." : "⚡ Quét & Đồng bộ repo cũ"}</span>
            </button>
          </div>
        )}

        {/* Thông báo kết quả Sync */}
        {syncMessage && (
          <div className="relative z-10 mt-3 p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-400 flex-shrink-0" />
            <span>{syncMessage}</span>
          </div>
        )}

        {/* 🔍 SEARCH & FILTERS CONTROLS */}
        <div className="relative z-10 mt-6 flex flex-col md:flex-row items-stretch md:items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm repo, tác giả, ngôn ngữ, hoặc bài toán cần giải quyết..."
              className="w-full rounded-xl border border-slate-700/80 bg-slate-950/80 py-3 pl-11 pr-10 text-sm text-white placeholder-slate-400 shadow-inner outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 backdrop-blur-md"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Sort Selector */}
            <div className="flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-xs text-slate-300">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={selectedSort}
                onChange={(e) => {
                  setSelectedSort(e.target.value);
                  setPagination((p) => ({ ...p, page: 1 }));
                }}
                aria-label="Sắp xếp danh sách kho mã nguồn"
                className="bg-transparent text-xs text-slate-200 outline-none cursor-pointer"
              >
                <option value="stars" className="bg-slate-900 text-white">⭐ Nhiều Stars nhất</option>
                <option value="newest" className="bg-slate-900 text-white">🕒 Mới chia sẻ nhất</option>
                <option value="forks" className="bg-slate-900 text-white">⑂ Nhiều Forks nhất</option>
                <option value="name" className="bg-slate-900 text-white">🔤 Tên A → Z</option>
              </select>
            </div>

            <button
              onClick={() => fetchRepos(pagination.page)}
              title="Làm mới danh sách"
              className="rounded-xl border border-slate-700/80 bg-slate-950/80 p-2.5 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-indigo-400" : ""}`} />
            </button>
          </div>
        </div>

        {/* 🏷️ CATEGORY PILLS (FindARepo Style) */}
        <div className="relative z-10 mt-6 flex flex-wrap gap-2 pt-2 border-t border-slate-800/80">
          {TAXONOMY.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            const count = cat.id === "all" ? stats.totalRepos || pagination.total : categoryCounts.get(cat.id) || 0;

            return (
              <button
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setPagination((p) => ({ ...p, page: 1 }));
                }}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-all ${
                  isSelected
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 scale-[1.02]"
                    : "bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/50"
                }`}
              >
                <span>{cat.emoji}</span>
                <span>{cat.label}</span>
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                      isSelected ? "bg-indigo-900/80 text-indigo-200" : "bg-slate-700/80 text-slate-300"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 📦 REPO CARDS GRID */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-64 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 animate-pulse flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="h-5 w-3/4 rounded bg-slate-800" />
                <div className="h-4 w-1/2 rounded bg-slate-800/60" />
                <div className="h-14 rounded bg-slate-800/40" />
              </div>
              <div className="h-8 rounded bg-slate-800/50" />
            </div>
          ))}
        </div>
      ) : repos.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-12 text-center max-w-lg mx-auto space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <FolderGit2 className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-bold text-white">Chưa có GitHub Repo nào phù hợp</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            {searchQuery || selectedCategory !== "all" || selectedGroupId !== "all"
              ? "Hãy thử chọn nhóm khác, xóa từ khóa hoặc chuyển sang danh mục 'Tất cả'."
              : "Khi thành viên trong nhóm chia sẻ liên kết GitHub, bot sẽ tự động phân loại và lưu trữ tại đây!"}
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            {(searchQuery || selectedCategory !== "all" || selectedGroupId !== "all") && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("all");
                  setSelectedGroupId("all");
                }}
                className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors"
              >
                Xem tất cả các nhóm
              </button>
            )}
            <button
              onClick={handleSyncHistoricRepos}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600/30 border border-emerald-500/40 px-4 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-600/50 transition-all"
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Quét link repo cũ ngay</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {repos.map((repo) => {
            const starText = formatStarCount(repo.stars);
            const isCopied = copiedUrl === repo.repo_url;

            return (
              <div
                key={repo.id}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/90 to-slate-950 p-5 shadow-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-500/50 hover:shadow-2xl hover:shadow-indigo-500/10"
              >
                {/* TOP ROW: REPO NAME & STARS */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <a
                        href={repo.repo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group/link inline-flex items-center gap-1.5 text-base font-bold text-white transition-colors hover:text-indigo-300 line-clamp-1"
                      >
                        <span className="truncate">{repo.full_name}</span>
                        <ExternalLink className="h-3.5 w-3.5 opacity-60 group-hover/link:opacity-100 flex-shrink-0" />
                      </a>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono truncate pt-0.5">
                        <span className="truncate">{repo.owner}</span>
                        {repo.group_name && (
                          <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-400 font-sans truncate max-w-[150px]">
                            {repo.group_name}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Star Badge */}
                    <div className="flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-xs font-bold text-amber-300 flex-shrink-0">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      <span>{starText}</span>
                    </div>
                  </div>

                  {/* PILLS ROW: CATEGORY & LANGUAGE */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Category */}
                    <span className="inline-flex items-center rounded-md bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[11px] font-semibold text-indigo-300">
                      {repo.category}
                    </span>

                    {/* Language */}
                    {repo.language && (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-800/80 px-2 py-0.5 text-[11px] font-medium text-slate-300 border border-slate-700/50">
                        <span className={`h-2 w-2 rounded-full ${getLanguageColor(repo.language)}`} />
                        <span>{repo.language}</span>
                      </span>
                    )}

                    {/* Forks */}
                    {repo.forks > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                        <GitFork className="h-3 w-3" />
                        <span>{repo.forks}</span>
                      </span>
                    )}
                  </div>

                  {/* VIETNAMESE SUMMARY (AI-GENERATED) */}
                  <div className="rounded-xl bg-slate-800/40 border border-slate-800/80 p-3 text-xs leading-relaxed text-slate-200">
                    <div className="flex items-center gap-1 text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1">
                      <Sparkles className="h-3 w-3" />
                      <span>Tóm Tắt Công Năng</span>
                    </div>
                    <p className="line-clamp-3 text-slate-300">
                      {repo.summary_vi || repo.description || "Công cụ mã nguồn mở hữu ích trên GitHub."}
                    </p>
                  </div>

                  {/* TARGET AUDIENCE */}
                  {repo.target_audience && (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Users className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                      <span className="truncate">
                        Phù hợp: <strong className="text-slate-300 font-medium">{repo.target_audience}</strong>
                      </span>
                    </div>
                  )}
                </div>

                {/* BOTTOM ROW: SENDER INFO & ACTIONS */}
                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[11px] truncate">
                    <Clock className="h-3 w-3 text-slate-500 flex-shrink-0" />
                    <span className="truncate">
                      Bởi <strong className="text-slate-300">{repo.shared_by_name || "Thành viên"}</strong>
                    </span>
                    <span>•</span>
                    <span className="text-slate-500 flex-shrink-0">{timeAgo(repo.created_at)}</span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleCopy(repo.repo_url)}
                      title="Sao chép liên kết"
                      className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                      {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>

                    <a
                      href={repo.repo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600/20 border border-indigo-500/30 px-2.5 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                    >
                      <span>Xem Repo</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 📄 PAGINATION */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-6">
          <button
            onClick={() => setPagination((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
            disabled={pagination.page <= 1}
            className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Trang trước</span>
          </button>

          <span className="px-3 text-xs text-slate-400">
            Trang <strong className="text-white">{pagination.page}</strong> / {pagination.totalPages}
          </span>

          <button
            onClick={() => setPagination((p) => ({ ...p, page: Math.min(pagination.totalPages, p.page + 1) }))}
            disabled={pagination.page >= pagination.totalPages}
            className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <span>Trang sau</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
