"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  History,
  LayoutDashboard,
  ListChecks,
  LogIn,
  MessageSquare,
  NotebookText,
  Settings,
  Trophy,
  UserMinus,
  UserRoundCheck,
  Users,
  Layers,
  Sparkles,
} from "lucide-react";
import { Suspense } from "react";

const GROUPS = [
  { id: "1913869945242410752", name: "AI, CÔNG NGHỆ", fullName: "GROUP TRAO ĐỔI - AI, CÔNG NGHỆ", icon: "🚀", count: "144 TV" },
  { id: "6918708484908920459", name: "HỘI ĂN NHẬU 🍻", fullName: "HỘI ĂN NHẬU 🍻", icon: "🍻", count: "12 TV" },
];

const NAV = [
  { href: "/", label: "Tổng quan", shortLabel: "Tổng quan", icon: LayoutDashboard },
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
  { href: "/login", label: "Đăng nhập", shortLabel: "Đăng nhập", icon: LogIn },
];

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
  const activeGroup = GROUPS.find((g) => g.id === activeGroupId) || (activeGroupId === "all" ? { id: "all", name: "Tất cả nhóm", fullName: "Tất cả các nhóm", icon: "🌐", count: "Tổng hợp" } : GROUPS[0]);

  const isPublicLeaderboard =
    publicMode || pathname === "/leaderboard" || pathname.startsWith("/leaderboard/");

  if (isPublicLeaderboard) {
    return <main className="min-h-screen">{children}</main>;
  }

  const buildNavHref = (baseHref: string) => {
    if (!activeGroupId || activeGroupId === "1913869945242410752") {
      return `${baseHref}${baseHref.includes("?") ? "&" : "?"}group=1913869945242410752`;
    }
    return `${baseHref}${baseHref.includes("?") ? "&" : "?"}group=${activeGroupId}`;
  };

  return (
    <>
      <div className="flex min-h-screen">
        <aside className="hidden md:flex md:w-64 md:shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-4 px-2">
            <div className="flex items-center gap-2 text-base font-bold text-[var(--color-text)]">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white text-xs">
                🤖
              </span>
              <span>Bot Member Zalo</span>
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-muted)]">Hệ thống quản lý đa nhóm</div>
          </div>

          {/* BỘ CHUYỂN PHÂN VÙNG NHÓM TRÊN TOÀN PANEL (WORKSPACE PARTITION SELECTOR) */}
          <div className="mb-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
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
              <Link
                href={`${pathname}?group=all`}
                className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
                  activeGroupId === "all"
                    ? "bg-[var(--color-primary)] text-white shadow-md shadow-blue-500/20"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>🌐</span>
                  <span>Tất cả các nhóm</span>
                </div>
              </Link>
            </div>
          </div>

          <nav className="flex flex-col gap-1 overflow-y-auto">
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
