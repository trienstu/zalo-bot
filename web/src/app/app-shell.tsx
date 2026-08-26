"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
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
} from "lucide-react";

const GROUPS = [
  { id: "1913869945242410752", name: "AI, CÔNG NGHỆ", fullName: "GROUP TRAO ĐỔI - AI, CÔNG NGHỆ", icon: "🚀", count: "144 TV" },
  { id: "6918708484908920459", name: "HỘI ĂN NHẬU 🍻", fullName: "HỘI ĂN NHẬU 🍻", icon: "🍻", count: "12 TV" },
];

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

// Khối 403 Forbidden dành cho người không có quyền truy cập
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
  const activeGroupId = searchParams.get("group") || "1913869945242410752";

  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean | null>(null);

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

  // 4. NẾU CHƯA ĐĂNG NHẬP ADMIN MÀ VÀO TRỰC TIẾP TRANG CHỦ / HOẶC BẤT KỲ TRANG ADMIN NÀO -> BÁO 403 FORBIDDEN
  if (isAdminAuthenticated === false) {
    return <ForbiddenAccessScreen />;
  }

  // 5. NẾU ĐÃ ĐĂNG NHẬP ADMIN -> HIỂN THỊ TOÀN BỘ BẢNG ĐIỀU KHIỂN QUẢN TRỊ
  const buildNavHref = (baseHref: string) => {
    if (!activeGroupId || activeGroupId === "1913869945242410752") {
      return `${baseHref}${baseHref.includes("?") ? "&" : "?"}group=1913869945242410752`;
    }
    return `${baseHref}${baseHref.includes("?") ? "&" : "?"}group=${activeGroupId}`;
  };

  return (
    <>
      <div className="flex min-h-screen">
        <aside className="hidden md:flex md:w-64 md:shrink-0 flex-col justify-between border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div>
            <div className="mb-4 px-2">
              <div className="flex items-center justify-between text-base font-bold text-[var(--color-text)]">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white text-xs">
                    🤖
                  </span>
                  <span>Bot Member Zalo</span>
                </div>
                <span className="text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 px-2 py-0.5 rounded font-mono font-bold">
                  ADMIN
                </span>
              </div>
              <div className="mt-0.5 text-xs text-[var(--color-muted)]">Hệ thống quản lý đa nhóm</div>
            </div>

            {/* BỘ CHUYỂN PHÂN VÙNG NHÓM */}
            <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
              <div className="px-1.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)] flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Layers className="h-3 w-3" /> Phân vùng nhóm:
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <div className="mt-1 flex flex-col gap-1">
                {GROUPS.map((g) => {
                  const isActive = activeGroupId === g.id;
                  return (
                    <Link
                      key={g.id}
                      href={`${pathname}?group=${g.id}`}
                      className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-all ${
                        isActive
                          ? "bg-[var(--color-primary)] text-white shadow-md shadow-blue-500/20"
                          : "text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span>{g.icon}</span>
                        <span className="truncate">{g.name}</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${isActive ? "bg-white/20 text-white" : "bg-[var(--color-surface)] text-[var(--color-muted)]"}`}>
                        {g.count}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <nav className="flex flex-col gap-1 overflow-y-auto max-h-[55vh]">
              {NAV.map((item) => {
                const Icon = item.icon;
                const isCurrent = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={buildNavHref(item.href)}
                    className={`flex items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-sm transition-colors ${
                      isCurrent
                        ? "bg-[var(--color-primary)]/10 font-semibold text-[var(--color-primary)] border border-[var(--color-primary)]/30"
                        : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    <Icon size={16} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Bottom Sidebar: Logout Admin */}
          <div className="border-t border-[var(--color-border)] pt-3 mt-4">
            <button
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800/80 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-950/40 hover:text-rose-200 border border-rose-500/20 transition-colors"
            >
              <LogOut size={14} />
              <span>Đăng xuất Admin</span>
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 overflow-auto p-4 pb-20 md:p-8 md:pb-8">{children}</main>
      </div>

      {/* Mobile Nav */}
      <nav className="fixed bottom-0 inset-x-0 z-50 flex overflow-x-auto md:hidden border-t border-[var(--color-border)] bg-[var(--color-surface)]">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={buildNavHref(item.href)}
              className="flex min-w-16 flex-1 flex-col items-center gap-1 py-2.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <Icon size={20} />
              <span className="text-[10px] leading-none">{item.shortLabel}</span>
            </Link>
          );
        })}
      </nav>
    </>
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
    <Suspense fallback={<main className="min-h-screen">{children}</main>}>
      <AppShellInner publicMode={publicMode}>{children}</AppShellInner>
    </Suspense>
  );
}
