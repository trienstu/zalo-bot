"use client";

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect, useMemo, Suspense } from "react";
import {
  AlertTriangle,
  History,
  LayoutDashboard,
  ListChecks,
  LogIn,
  LogOut,
  MessageSquare,
  NotebookText,
  Settings,
  Trophy,
  UserMinus,
  UserRoundCheck,
  Users,
  Layers,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Search,
  CheckCircle2,
  SlidersHorizontal,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
} from "lucide-react";

interface GroupItem {
  id: string;
  name: string;
  fullName: string;
  icon: string;
  count: string;
  mode?: "interactive" | "silent" | "disabled";
  isActive?: boolean;
}

const NAV = [
  { href: "/", label: "Tổng quan", shortLabel: "Tổng quan", icon: LayoutDashboard },
  { href: "/hub", label: "Kho Kiến Thức", shortLabel: "Kiến thức", icon: Sparkles },
  { href: "/members", label: "Thành viên", shortLabel: "Thành viên", icon: Users },
  { href: "/leaderboard", label: "Xếp hạng", shortLabel: "Top", icon: Trophy },
  { href: "/candidates", label: "Ứng viên", shortLabel: "Ứng viên", icon: UserMinus },
  { href: "/cleanup-plan", label: "Duyệt DS", shortLabel: "Duyệt", icon: ListChecks },
  { href: "/events", label: "Sự kiện TV", shortLabel: "Sự kiện", icon: UserRoundCheck },
  { href: "/messages", label: "Tin nhắn", shortLabel: "Tin nhắn", icon: MessageSquare },
  { href: "/summaries", label: "Tóm tắt ngày", shortLabel: "Tóm tắt", icon: NotebookText },
  { href: "/history", label: "Lịch sử dọn", shortLabel: "Lịch sử", icon: History },
  { href: "/errors", label: "Lỗi", shortLabel: "Lỗi", icon: AlertTriangle },
  { href: "/settings", label: "Cấu hình", shortLabel: "Cấu hình", icon: Settings },
  { href: "/login", label: "Đăng nhập Zalo", shortLabel: "Zalo QR", icon: LogIn },
];

function ForbiddenAccessScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-rose-500/20 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-xl text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-white tracking-tight">403 — Không Có Quyền Truy Cập</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Trang này chỉ dành riêng cho Quản trị viên hệ thống. Vui lòng quay lại Kho Kiến Thức để xem các tài liệu và chia sẻ từ cộng đồng.
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/hub"
            className="flex items-center justify-center gap-2 w-full rounded-xl bg-cyan-500 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
          >
            <span>Vào Kho Kiến Thức Cộng Đồng</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function AppShellInner({
  children,
  publicMode = false,
}: {
  children: React.ReactNode;
  publicMode?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean | null>(null);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [syncingGroups, setSyncingGroups] = useState(false);
  const [syncingMembers, setSyncingMembers] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Lấy danh sách nhóm động từ API
  async function loadGroups() {
    setLoadingGroups(true);
    try {
      const res = await fetch("/api/groups");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.groups)) {
          setGroups(data.groups);
        }
      }
    } catch {}
    setLoadingGroups(false);
  }

  // Quét và đồng bộ nhóm từ Bot Zalo
  async function handleSyncGroups() {
    setSyncingGroups(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.groups) && data.groups.length > 0) {
          setGroups(data.groups);
        }
      }
    } catch {}
    await loadGroups();
    setSyncingGroups(false);
  }

  // Đồng bộ danh sách chi tiết thành viên của nhóm đang chọn
  async function handleSyncMembers(targetGroupId?: string) {
    setSyncingMembers(true);
    try {
      await fetch("/api/member-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: targetGroupId || activeGroupId }),
      });
    } catch {}
    setTimeout(() => {
      setSyncingMembers(false);
      router.refresh();
    }, 2500);
  }

  // Đổi chế độ hoạt động cho nhóm: 'interactive' | 'silent' | 'disabled'
  async function handleSetGroupMode(groupId: string, mode: "interactive" | "silent" | "disabled") {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, mode, icon: mode === "silent" ? "🟡" : mode === "disabled" ? "🔴" : "🟢" } : g)),
    );

    try {
      await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_mode", groupId, mode }),
      });
    } catch {}
  }

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth");
        if (res.ok) {
          const data = await res.json();
          setIsAdminAuthenticated(data.authenticated === true || localStorage.getItem("admin_auth") === "true");
        } else {
          setIsAdminAuthenticated(localStorage.getItem("admin_auth") === "true");
        }
      } catch {
        setIsAdminAuthenticated(localStorage.getItem("admin_auth") === "true");
      }
    }
    checkAuth();
    loadGroups();
  }, [pathname]);

  async function handleLogout() {
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch {}
    localStorage.removeItem("admin_auth");
    setIsAdminAuthenticated(false);
  }

  // 1. TRANG CÔNG KHAI THUẦN TÚY: Kho Kiến Thức (/hub)
  const isHubPublicPage = pathname === "/hub" || pathname.startsWith("/hub/");
  if (isHubPublicPage) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
        <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-4 py-3">
          <div className="container mx-auto flex items-center justify-between max-w-7xl">
            <Link href="/hub" className="flex items-center gap-2.5 font-bold text-white text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20">
                🤖
              </span>
              <span>Zalo Community Hub</span>
            </Link>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 px-3 py-1 text-xs font-semibold text-cyan-300">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Kho Kiến Thức & Tài Nguyên</span>
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    );
  }

  // 2. TRANG ĐĂNG NHẬP ADMIN CHUYÊN DỤNG (/admin)
  const isAdminLoginRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  if (isAdminLoginRoute) {
    return <main className="min-h-screen bg-slate-950">{children}</main>;
  }

  // 3. ĐANG TẢI KIỂM TRA PHIÊN
  if (isAdminAuthenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  // 4. NẾU CHƯA ĐĂNG NHẬP ADMIN -> BÁO 403 FORBIDDEN
  if (isAdminAuthenticated === false) {
    return <ForbiddenAccessScreen />;
  }

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);

  const activeGroupId = searchParams.get("group") || (groups.length > 0 ? groups[0].id : "");
  const activeGroup = groups.find((g) => g.id === activeGroupId);

  const filteredGroups = groups.filter(
    (g) =>
      !searchQuery ||
      g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.id.includes(searchQuery),
  );

  const buildNavHref = (baseHref: string) => {
    if (!activeGroupId) return baseHref;
    return `${baseHref}${baseHref.includes("?") ? "&" : "?"}group=${activeGroupId}`;
  };

  // Hàm render nội dung cột nhóm (tái sử dụng cho cả desktop sidebar và mobile drawer)
  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col h-full bg-slate-900/95 backdrop-blur-md">
      {/* Header Cột Trái */}
      <div className="p-3.5 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500 text-slate-950 font-bold text-xs">
              🤖
            </span>
            <div>
              <h1 className="text-sm font-bold text-white leading-none">Bot Member Zalo</h1>
              <span className="text-[10px] text-cyan-400 font-mono">Multi-Group Manager</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleSyncGroups}
              disabled={syncingGroups}
              title="Quét lại tất cả các nhóm trên Zalo"
              className="flex items-center gap-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 px-2 py-1 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all"
            >
              <RefreshCw className={`h-3 w-3 ${syncingGroups ? "animate-spin text-cyan-300" : ""}`} />
              <span>Quét</span>
            </button>
            {isMobile && (
              <button
                onClick={() => setMobileSidebarOpen(false)}
                className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
                title="Đóng bảng nhóm"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Ô Tìm Kiếm Nhóm */}
        <div className="relative mt-3">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm nhanh nhóm Zalo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg bg-slate-950/80 border border-slate-800 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Danh Sách Tất Cả Nhóm Hoạt Động */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
          <span>Danh sách nhóm ({filteredGroups.length})</span>
          <span className="text-[10px] font-mono text-cyan-400">Click để chọn</span>
        </div>

        {filteredGroups.length > 0 ? (
          filteredGroups.map((g) => {
            const isActive = activeGroupId === g.id;
            const mode = g.mode || "interactive";

            return (
              <div
                key={g.id}
                className={`group relative rounded-xl p-2.5 transition-all border ${
                  isActive
                    ? "border-cyan-500/60 bg-gradient-to-r from-cyan-950/40 to-slate-900 shadow-md shadow-cyan-500/10 ring-1 ring-cyan-500/30"
                    : "border-slate-800/80 bg-slate-950/40 hover:bg-slate-800/50 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`${pathname}?group=${g.id}`}
                    onClick={() => {
                      if (isMobile) setMobileSidebarOpen(false);
                    }}
                    className="flex-1 min-w-0"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{g.icon || "👥"}</span>
                      <h4 className={`text-xs font-bold truncate ${isActive ? "text-cyan-300" : "text-slate-200 group-hover:text-white"}`}>
                        {g.name}
                      </h4>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                      <span className="bg-slate-800/80 px-1.5 py-0.2 rounded text-slate-300 font-bold">{g.count}</span>
                      <span className="truncate max-w-[120px]">ID: {g.id}</span>
                    </div>
                  </Link>

                  {isActive && (
                    <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-pulse mt-1 shrink-0" />
                  )}
                </div>

                {/* 3 Nút Chọn Chế Độ Hoạt Động (Xanh - Vàng - Đỏ) */}
                <div className="mt-2.5 flex items-center justify-between border-t border-slate-800/60 pt-2 text-[10px]">
                  <span className="text-slate-400 font-medium">Chế độ:</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetGroupMode(g.id, "interactive");
                      }}
                      title="🟢 Toàn quyền tương tác: Bot trả lời lệnh, tương tác với mọi người"
                      className={`rounded px-1.5 py-0.5 font-bold transition-all ${
                        mode === "interactive"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 ring-1 ring-emerald-500/30"
                          : "text-slate-400 hover:text-white hover:bg-slate-800"
                      }`}
                    >
                      🟢 Tương tác
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetGroupMode(g.id, "silent");
                      }}
                      title="🟡 Tàu ngầm ẩn: Bot im lặng 100%, chỉ cào kiến thức/file lên /hub"
                      className={`rounded px-1.5 py-0.5 font-bold transition-all ${
                        mode === "silent"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/50 ring-1 ring-amber-500/30"
                          : "text-slate-400 hover:text-white hover:bg-slate-800"
                      }`}
                    >
                      🟡 Ẩn
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetGroupMode(g.id, "disabled");
                      }}
                      title="🔴 Tắt: Bot bỏ qua hoàn toàn nhóm này"
                      className={`rounded px-1.5 py-0.5 font-bold transition-all ${
                        mode === "disabled"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/50 ring-1 ring-rose-500/30"
                          : "text-slate-400 hover:text-white hover:bg-slate-800"
                      }`}
                    >
                      🔴 Tắt
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-4 text-center text-xs text-slate-400">
            <p>Chưa tìm thấy nhóm nào</p>
            <button
              onClick={handleSyncGroups}
              disabled={syncingGroups}
              className="mt-2 inline-flex items-center gap-1 rounded bg-cyan-500/10 border border-cyan-500/30 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingGroups ? "animate-spin" : ""}`} />
              <span>Quét nhóm Zalo</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer Cột Trái */}
      <div className="p-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
        <span>Tổng: <strong className="text-white">{groups.length}</strong> nhóm</span>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 text-rose-400 hover:text-rose-300 font-semibold"
        >
          <LogOut size={13} />
          <span>Đăng xuất</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* 📱 1. MOBILE DRAWER (Bảng trượt nhóm trên điện thoại) */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] flex flex-col border-r border-slate-800 bg-slate-900 shadow-2xl transition-transform duration-300 ease-in-out lg:hidden ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {renderSidebarContent(true)}
      </aside>

      {/* 💻 2. DESKTOP SIDEBAR (Cột trái trên máy tính, có thể ẩn/hiện) */}
      {desktopSidebarOpen && (
        <aside className="hidden lg:flex w-80 shrink-0 flex-col border-r border-slate-800 bg-slate-900/90 backdrop-blur-md transition-all duration-300">
          {renderSidebarContent(false)}
        </aside>
      )}

      {/* 👉 KHU VỰC CHÍNH: THANH MENU TRÊN ĐẦU NẰM NGANG & NỘI DUNG */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 🌟 THANH NAVIGATION NẰM NGANG TRÊN ĐẦU */}
        <header className="shrink-0 border-b border-slate-800 bg-slate-900/95 backdrop-blur-md px-3 sm:px-4 py-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            {/* Nút Toggle Nhóm trên Mobile */}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
              className="lg:hidden flex items-center gap-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/40 px-2.5 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/25 transition-all shrink-0"
            >
              <Menu className="h-4 w-4" />
              <span className="truncate max-w-[120px] font-semibold">{activeGroup?.name || "Chọn nhóm"}</span>
              <ChevronDown className="h-3 w-3 opacity-70" />
            </button>

            {/* Nút Toggle Ẩn/Hiện Cột Trái trên Desktop */}
            <button
              type="button"
              onClick={() => setDesktopSidebarOpen(!desktopSidebarOpen)}
              title={desktopSidebarOpen ? "Ẩn danh sách nhóm để mở rộng toàn màn hình" : "Hiện danh sách nhóm"}
              className="hidden lg:flex items-center gap-1.5 rounded-xl bg-slate-800/80 border border-slate-700/80 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-all shrink-0 cursor-pointer"
            >
              {desktopSidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
              <span className="font-semibold">{desktopSidebarOpen ? "Ẩn nhóm" : "Hiện nhóm"}</span>
            </button>

            {/* Thanh menu nằm ngang cuộn mượt */}
            <nav className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-1 flex-1 min-w-0">
              {NAV.map((item) => {
                const Icon = item.icon;
                const isCurrent = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={buildNavHref(item.href)}
                    className={`flex items-center gap-1.5 rounded-xl px-2.5 sm:px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all ${
                      isCurrent
                        ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20"
                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                  >
                    <Icon size={14} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Nút tác vụ nhanh bên phải */}
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              {activeGroup && (
                <div className="hidden xl:flex items-center gap-1.5 rounded-xl bg-slate-950 border border-slate-800 px-3 py-1 text-xs">
                  <span className="text-slate-400">Đang chọn:</span>
                  <span className="font-bold text-cyan-300 truncate max-w-[140px]">{activeGroup.name}</span>
                </div>
              )}
              <button
                onClick={() => handleSyncMembers(activeGroupId)}
                disabled={syncingMembers}
                className="flex items-center gap-1.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncingMembers ? "animate-spin text-cyan-300" : ""}`} />
                <span className="hidden md:inline">{syncingMembers ? "Đang đồng bộ..." : "Đồng bộ TV"}</span>
              </button>
            </div>
          </div>
        </header>

        {/* Nội dung chi tiết của trang theo Nhóm đang chọn (Full width & padding mượt trên Mobile) */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6 bg-slate-950">
          {children}
        </main>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  publicMode = false,
}: {
  children: React.ReactNode;
  publicMode?: boolean;
}) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">Đang tải...</main>}>
      <AppShellInner publicMode={publicMode}>{children}</AppShellInner>
    </Suspense>
  );
}
