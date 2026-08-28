import { LayoutDashboard, Users, Trophy, MessageSquare, NotebookText, RefreshCw, ExternalLink, ShieldCheck } from "lucide-react";
import Link from "next/link";
import fs from "node:fs";
import { Stat, PageHeader, Card, CardTitle, EmptyState, RunStatusBadge, Badge, Button } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import {
  dbExists,
  countActiveMembers,
  countByRole,
  countInteractions,
  listScanRuns,
  getState,
  getLatestMemberSyncRun,
  getLatestMemberSyncRuns,
  getBotHealth,
  getPermissionCheckStatus,
  isBotHealthFresh,
  listManagedGroups,
} from "@/lib/db";
import { readConfig } from "@/lib/config";
import { CONFIG_DEFAULTS } from "@/lib/config-meta";
import { memberSyncRequestPath, permissionCheckRequestPath } from "@/lib/login-status";
import { SyncMembersCard } from "./sync-members-card";
import { BotHealthCard } from "./bot-health-card";
import { PermissionCheckCard } from "./permission-check-card";

export const dynamic = "force-dynamic";

const WARMUP_KEY = "warmup_started_at";

type SearchParams = Record<string, string | string[] | undefined>;

function one(params: SearchParams | undefined, key: string): string {
  const value = params?.[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function warmupInfo(warmupDays: number): { collected: number; remaining: number; startedAt: number | null } {
  const raw = getState(WARMUP_KEY);
  if (!raw) return { collected: 0, remaining: warmupDays, startedAt: null };
  const startedAt = Number(raw);
  const collected = Math.floor((Date.now() - startedAt) / 86400000);
  return { collected, remaining: Math.max(0, warmupDays - collected), startedAt };
}

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Tổng quan" desc="Bảng điều khiển bot dọn thành viên group Zalo" />
        <EmptyState>
          Chưa tìm thấy dữ liệu bot. Hãy chạy bot (<code>npm start</code> trong thư mục <code>bot/</code>)
          ít nhất một lần để tạo cơ sở dữ liệu.
        </EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const groups = listManagedGroups();
  const defaultGroupId = groups[0]?.id || "";
  const selectedGroupId = one(params, "group") || defaultGroupId || "all";
  const activeGroup = groups.find((g) => g.id === selectedGroupId) || groups[0] || { id: "all", name: "Nhóm Zalo" };

  const total = countActiveMembers();
  const roles = countByRole();
  const interactions = countInteractions(activeGroup.id !== "all" ? activeGroup.id : undefined);
  const cfg = readConfig();
  const target = cfg.targetMemberCount ?? CONFIG_DEFAULTS.targetMemberCount;
  const warmupDays = cfg.warmupDays ?? CONFIG_DEFAULTS.warmupDays;
  const warmup = warmupInfo(warmupDays);
  const overTarget = Math.max(0, (activeGroup.memberCount ?? total) - target);
  const runs = listScanRuns(5);
  const latestSync = getLatestMemberSyncRun() ?? null;
  const latestSyncRuns = getLatestMemberSyncRuns();
  const groupSync = latestSyncRuns.find((r) => r.group_id === activeGroup.id);
  const syncPending = fs.existsSync(memberSyncRequestPath());
  const health = getBotHealth();
  const botFresh = isBotHealthFresh(health);
  const permission = getPermissionCheckStatus();
  const permissionPending = fs.existsSync(permissionCheckRequestPath());

  return (
    <div className="flex flex-col gap-6">
      {/* 🌟 BANNER TỔNG QUAN NHÓM ĐANG CHỌN */}
      <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-slate-900 via-slate-900/90 to-cyan-950/30 p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-2xl shrink-0">
              👥
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                  {activeGroup.name}
                </h1>
                <Badge tone="ok" className="text-xs">Đang kiểm soát</Badge>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-1">
                ID Nhóm: <span className="text-cyan-300 font-semibold">{activeGroup.id}</span> · Cập nhật theo thời gian thực
              </p>
            </div>
          </div>

          {/* Lối tắt nhanh sang các tính năng của nhóm này */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/leaderboard?group=${activeGroup.id}`}
              className="flex items-center gap-1.5 rounded-xl bg-slate-800/80 border border-slate-700/80 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-cyan-500 hover:text-slate-950 transition-all shadow-sm"
            >
              <Trophy className="h-3.5 w-3.5 text-amber-400" />
              <span>Xếp hạng</span>
            </Link>
            <Link
              href={`/members?group=${activeGroup.id}`}
              className="flex items-center gap-1.5 rounded-xl bg-slate-800/80 border border-slate-700/80 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-cyan-500 hover:text-slate-950 transition-all shadow-sm"
            >
              <Users className="h-3.5 w-3.5 text-cyan-400" />
              <span>Thành viên</span>
            </Link>
            <Link
              href={`/messages?group=${activeGroup.id}`}
              className="flex items-center gap-1.5 rounded-xl bg-slate-800/80 border border-slate-700/80 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-cyan-500 hover:text-slate-950 transition-all shadow-sm"
            >
              <MessageSquare className="h-3.5 w-3.5 text-emerald-400" />
              <span>Tin nhắn</span>
            </Link>
            <Link
              href={`/summaries?group=${activeGroup.id}`}
              className="flex items-center gap-1.5 rounded-xl bg-slate-800/80 border border-slate-700/80 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-cyan-500 hover:text-slate-950 transition-all shadow-sm"
            >
              <NotebookText className="h-3.5 w-3.5 text-purple-400" />
              <span>Tóm tắt</span>
            </Link>
            <Link
              href={`/settings?group=${activeGroup.id}`}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500/15 border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500 hover:text-slate-950 transition-all shadow-sm"
            >
              <span>⚙️ Cấu hình AI</span>
            </Link>
          </div>
        </div>
      </div>

      {/* THỐNG KÊ CHI TIẾT CỦA NHÓM ĐANG CHỌN */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Thành viên nhóm"
          value={activeGroup.memberCount ?? total}
          sub={`${roles.member} thường · ${roles.admin} admin · ${roles.owner} owner`}
        />
        <Stat
          label="Tương tác đã ghi nhận"
          value={interactions}
          sub="chat + reaction + vote trong nhóm"
        />
        <Stat
          label="Mục tiêu duy trì"
          value={target}
          sub={overTarget > 0 ? `vượt ${overTarget} người` : "đang trong ngưỡng an toàn"}
        />
        <Stat
          label="Tình trạng Sync"
          value={groupSync?.status === "done" ? "Đã đồng bộ" : "Sẵn sàng"}
          sub={groupSync?.finished_at ? `Gần nhất: ${fmtDateTime(groupSync.finished_at)}` : "Tự động theo lịch"}
        />
      </div>

      <div className="mt-8">
        <SyncMembersCard initialLatest={latestSync} initialPending={syncPending} botReady={botFresh} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <BotHealthCard health={health} />
        <PermissionCheckCard initialLatest={permission} initialPending={permissionPending} botReady={botFresh} />
      </div>

      <div className="mt-8">
        <Card>
          <CardTitle>Các kỳ dọn gần nhất</CardTitle>
          {runs.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-muted)]">Chưa có kỳ dọn nào.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {runs.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[var(--color-muted)]">#{r.id}</span>
                    <RunStatusBadge status={r.status} />
                    <span className="text-[var(--color-muted)]">{fmtDateTime(r.started_at)}</span>
                  </div>
                  <div className="text-[var(--color-muted)]">
                    {r.actual_kicks ?? 0} kick / {r.member_count ?? "—"} thành viên
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 flex items-center gap-2 text-xs text-[var(--color-muted)]">
        <LayoutDashboard size={14} />
        Panel chỉ đọc dữ liệu + chỉnh cấu hình. Mọi thao tác Zalo (kick, cảnh báo) do bot thực hiện.
      </div>
    </div>
  );
}
