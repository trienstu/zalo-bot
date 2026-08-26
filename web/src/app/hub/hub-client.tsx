"use client";

import { useState, useEffect, useMemo } from "react";
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
  Bookmark,
  Calendar,
  FolderDown,
  Download,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui";

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
}

const CATEGORIES = [
  { id: "all", label: "Tất cả", icon: Layers },
  { id: "ai", label: "🤖 AI & Video", icon: Sparkles },
  { id: "mmo", label: "💼 MMO & Tut Mẹo", icon: Flame },
  { id: "files", label: "📂 File & Tài liệu Drive", icon: FolderDown },
  { id: "links", label: "🔗 Link & Công cụ", icon: LinkIcon },
];

export function HubClient() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalItems: 0, totalLinks: 0, totalFiles: 0, totalContributors: 0 });
  const [savedItemIds, setSavedItemIds] = useState<string[]>([]);
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const res = await fetch("/api/hub");
        if (res.ok) {
          const data = await res.json();
          setItems(data.items || []);
          if (data.stats) setStats(data.stats);
        }
      } catch (e) {
        console.error("Lỗi tải kho kiến thức:", e);
      } finally {
        setLoading(false);
      }
    }
    loadData();

    // Load saved bookmarks from localStorage
    try {
      const saved = localStorage.getItem("saved_hub_items");
      if (saved) setSavedItemIds(JSON.parse(saved));
    } catch {}
  }, []);

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
    }\n\nNguồn: Nhóm Zalo Community (${item.date})`;
    navigator.clipboard.writeText(content);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCat = selectedCategory === "all" || item.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.author.toLowerCase().includes(q) ||
        item.keyPoints.some((kp) => kp.toLowerCase().includes(q)) ||
        item.links.some((l) => l.url.toLowerCase().includes(q));
      return matchesCat && matchesSearch;
    });
  }, [items, selectedCategory, searchQuery]);

  return (
    <div className="min-h-screen space-y-8 pb-16">
      {/* 🌟 HERO BANNER & STATS */}
      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900 via-slate-900/90 to-cyan-950/40 p-6 md:p-10 shadow-2xl backdrop-blur-xl">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-16 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
            <Sparkles className="h-3.5 w-3.5" />
            <span>AI Knowledge & Resource Hub</span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white md:text-4xl">
            Kho Kiến Thức & Tài Nguyên Cộng Đồng
          </h1>

          <p className="text-sm text-slate-300 md:text-base leading-relaxed">
            Tổng hợp tự động toàn bộ kinh nghiệm, tút kiếm tiền, hướng dẫn AI, kho link và tài liệu được chia sẻ từ cộng đồng Zalo mỗi ngày.
          </p>

          {/* Stat Badges */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <div className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-3.5 py-1.5 border border-slate-700/60 text-xs font-medium text-slate-200">
              <BookOpen className="h-4 w-4 text-cyan-400" />
              <span>
                <strong className="text-cyan-300">{stats.totalItems || items.length}</strong> bài đúc kết
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

        {/* 🔍 SEARCH BAR */}
        <div className="relative z-10 mt-6 max-w-2xl">
          <div className="relative flex items-center">
            <Search className="absolute left-4 h-5 w-5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm theo chủ đề, từ khóa (ví dụ: Adsense, Video AI, TikTok, Canva, link drive...)"
              className="w-full rounded-xl border border-slate-700/80 bg-slate-950/80 py-3.5 pl-12 pr-4 text-sm text-white placeholder-slate-400 shadow-inner outline-none transition-all focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 backdrop-blur-md"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 rounded-md px-2 py-1 text-xs text-slate-400 hover:text-white"
              >
                Xóa
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 🏷️ CATEGORY TABS */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-4">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const active = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
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
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-12 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-slate-200">Không tìm thấy kiến thức phù hợp</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Thử tìm kiếm với từ khóa khác hoặc chuyển sang danh mục "Tất cả" để khám phá thêm nhé.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => {
            const isSaved = savedItemIds.includes(item.id);
            const isCopied = copiedId === item.id;

            return (
              <div
                key={item.id}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/70 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-cyan-500/40 hover:shadow-xl hover:shadow-cyan-500/5 backdrop-blur-sm"
              >
                <div>
                  {/* Top Bar: Category & Date */}
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
                    className="mt-3 text-base font-semibold text-white leading-snug group-hover:text-cyan-300 transition-colors cursor-pointer hover:underline"
                    title="Bấm để xem chi tiết nội dung"
                  >
                    {item.title}
                  </h3>

                  {/* Key Points */}
                  <div className="mt-3 space-y-2 text-xs text-slate-300 leading-relaxed">
                    {item.keyPoints.slice(0, 3).map((point, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <span className="text-cyan-400 font-bold">•</span>
                        <p className="line-clamp-2">{point}</p>
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
                    <div className="mt-4 space-y-2 rounded-lg bg-slate-950/60 p-3 border border-slate-800">
                      <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5">
                        {item.links.some((l) => l.isFile) ? (
                          <>
                            <FolderDown className="h-3.5 w-3.5 text-amber-400" />
                            <span className="text-amber-300">File & Tài liệu đính kèm:</span>
                          </>
                        ) : (
                          <>
                            <LinkIcon className="h-3.5 w-3.5 text-emerald-400" />
                            <span>Tài nguyên & Link:</span>
                          </>
                        )}
                      </span>
                      {item.links.slice(0, 2).map((l, idx) => (
                        <a
                          key={idx}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center justify-between gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors truncate ${
                            l.isFile
                              ? "bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20"
                              : "bg-slate-900/80 text-cyan-300 border border-slate-700/60 hover:bg-slate-800 hover:text-cyan-200"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            {l.isFile ? <Download className="h-3.5 w-3.5 shrink-0 text-amber-400" /> : <ExternalLink className="h-3 w-3 shrink-0 text-cyan-400" />}
                            <span className="truncate">{l.url}</span>
                          </div>
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider opacity-80">
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

      {/* 📄 MODAL XEM CHI TIẾT BÀI VIẾT */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-cyan-500/30 bg-slate-900 p-6 md:p-8 shadow-2xl space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-0.5 text-xs text-cyan-300 mb-2">
                  <Tag className="h-3 w-3" />
                  {selectedItem.categoryLabel}
                </span>
                <h2 className="text-xl font-bold text-white leading-snug">{selectedItem.title}</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Được đúc kết từ thảo luận ngày {selectedItem.date} · Chia sẻ bởi {selectedItem.author}
                </p>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="rounded-lg bg-slate-800 p-2 text-slate-400 hover:text-white hover:bg-slate-700"
              >
                ✕
              </button>
            </div>

            {/* Chi tiết nội dung */}
            <div className="space-y-3 text-sm text-slate-200 leading-relaxed">
              <h4 className="font-semibold text-cyan-300 text-xs uppercase tracking-wider">
                Chi tiết & Các bước thực hành:
              </h4>
              <div className="space-y-2 rounded-xl bg-slate-950/70 p-4 border border-slate-800">
                {selectedItem.keyPoints.map((kp, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <span className="text-cyan-400 font-bold mt-0.5">•</span>
                    <p className="text-slate-300">{kp}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Link & File đính kèm */}
            {selectedItem.links.length > 0 && (
              <div className="space-y-2 pt-2">
                <h4 className="font-semibold text-emerald-400 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  {selectedItem.links.some((l) => l.isFile) ? (
                    <>
                      <FolderDown className="h-4 w-4 text-amber-400" />
                      <span className="text-amber-300">File & Tài liệu đính kèm:</span>
                    </>
                  ) : (
                    <>
                      <LinkIcon className="h-4 w-4 text-emerald-400" />
                      <span>Đường link & Tài nguyên:</span>
                    </>
                  )}
                </h4>
                <div className="space-y-2">
                  {selectedItem.links.map((l, idx) => (
                    <a
                      key={idx}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-between rounded-lg p-3 text-xs transition-colors ${
                        l.isFile
                          ? "border border-amber-500/30 bg-amber-950/20 text-amber-300 hover:bg-amber-950/40"
                          : "border border-emerald-500/20 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate max-w-[450px]">
                        {l.isFile ? <Download className="h-4 w-4 text-amber-400 shrink-0" /> : <ExternalLink className="h-4 w-4 shrink-0" />}
                        <span className="truncate">{l.url}</span>
                      </div>
                      <span className="text-[11px] font-bold uppercase shrink-0 px-2 py-0.5 rounded bg-slate-900 border border-slate-700">
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
