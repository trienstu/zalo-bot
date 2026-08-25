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
  const defaultGroupId = groups[0]?.id || "1913869945242410752";
  const selectedGroupId = one(params, "group") || "all";
  const activeGroup = groups.find((g) => g.id === selectedGroupId) || { id: "all", name: "Tất cả các nhóm" };

  const total = countActiveMembers();
  const roles = countByRole();
  const interactions = countInteractions(selectedGroupId);
  const cfg = readConfig();
  const target = cfg.targetMemberCount ?? CONFIG_DEFAULTS.targetMemberCount;
  const warmupDays = cfg.warmupDays ?? CONFIG_DEFAULTS.warmupDays;
  const warmup = warmupInfo(warmupDays);
  const overTarget = Math.max(0, total - target);
  const runs = listScanRuns(5);
  const latestSync = getLatestMemberSyncRun() ?? null;
  const latestSyncRuns = getLatestMemberSyncRuns();
  const syncPending = fs.existsSync(memberSyncRequestPath());
  const health = getBotHealth();
  const botFresh = isBotHealthFresh(health);
  const permission = getPermissionCheckStatus();
  const permissionPending = fs.existsSync(permissionCheckRequestPath());

  return (
    <div>
      <PageHeader
        title="Tổng quan hệ thống"
        desc="Quản lý và theo dõi các nhóm Zalo do Bot Member tự động kiểm soát"
      />

      {/* Bộ chọn Nhóm (Multi-Group Selector Tab) */}
      {groups.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] px-2 flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Xem nhóm:
          </span>
          <Link
            href="/"
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-all border ${
              selectedGroupId === "all"
                ? "border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_18%,transparent)] text-[var(--color-primary)] shadow-sm shadow-blue-500/10"
                : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            <span>🌐 Tất cả nhóm ({groups.length})</span>
          </Link>
          {groups.map((g) => {
            const active = selectedGroupId === g.id;
            return (
              <Link
                key={g.id}
                href={`/?group=${g.id}`}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-all border ${
                  active
                    ? "border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_18%,transparent)] text-[var(--color-primary)] shadow-sm shadow-blue-500/10"
                    : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                <span className="truncate max-w-[200px]">{g.name}</span>
                {g.memberCount ? (
                  <span className={`text-[11px] px-1.5 py-0.2 rounded-full font-mono ${active ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface)] text-[var(--color-muted)]"}`}>
                    {g.memberCount} TV
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}

      {/* DANH SÁCH CÁC NHÓM ĐANG QUẢN LÝ (GROUP MANAGEMENT CARDS) */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3 flex items-center gap-2">
          <span>Danh sách các nhóm đang quản lý ({groups.length} nhóm)</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map((g, idx) => {
            const groupInteractions = countInteractions(g.id);
            const groupSync = latestSyncRuns.find((r) => r.group_id === g.id);
            const isHighlighted = selectedGroupId === g.id || selectedGroupId === "all";

            return (
              <Card
                key={g.id}
                className={`relative overflow-hidden transition-all border-2 ${
                  selectedGroupId === g.id
                    ? "border-[var(--color-primary)] shadow-lg shadow-blue-500/10"
                    : "border-[var(--color-border)] hover:border-[var(--color-primary)]/50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-xs font-bold text-[var(--color-primary)]">
                        {idx + 1}
                      </span>
                      <h3 className="text-base font-bold text-[var(--color-text)] truncate">
                        {g.name}
                      </h3>
                      {selectedGroupId === g.id ? (
                        <Badge tone="ok" className="text-[10px]">Đang chọn</Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-muted)] font-mono">
                      ID: {g.id}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 border-y border-[var(--color-border)] py-3 text-center">
                  <div>
                    <div className="text-lg font-bold text-[var(--color-text)]">{g.memberCount ?? total}</div>
                    <div className="text-[11px] text-[var(--color-muted)]">Thành viên</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-[var(--color-primary)]">{groupInteractions}</div>
                    <div className="text-[11px] text-[var(--color-muted)]">Tương tác</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-emerald-400 mt-0.5">
                      {groupSync?.status === "done" ? "Đã sync" : "Sẵn sàng"}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {groupSync?.finished_at ? fmtDateTime(groupSync.finished_at).split(" ")[1] : "Mới nhất"}
                    </div>
                  </div>
                </div>

                {/* Các nút lối tắt nhanh cho nhóm */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/leaderboard?group=${g.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-primary)] hover:text-white transition-colors border border-[var(--color-border)]"
                  >
                    <Trophy className="h-3.5 w-3.5 text-amber-400" />
                    <span>Xếp hạng</span>
                  </Link>
                  <Link
                    href={`/members?group=${g.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-primary)] hover:text-white transition-colors border border-[var(--color-border)]"
                  >
                    <Users className="h-3.5 w-3.5 text-blue-400" />
                    <span>Thành viên</span>
                  </Link>
                  <Link
                    href={`/messages?group=${g.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-primary)] hover:text-white transition-colors border border-[var(--color-border)]"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Tin nhắn</span>
                  </Link>
                  <Link
                    href={`/summaries?group=${g.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-primary)] hover:text-white transition-colors border border-[var(--color-border)]"
                  >
                    <NotebookText className="h-3.5 w-3.5 text-purple-400" />
                    <span>Tóm tắt</span>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* THỐNG KÊ CHI TIẾT */}
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3 flex items-center gap-2">
        <span>Thống kê {activeGroup.name ? `· ${activeGroup.name}` : ""}</span>
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Thành viên đang có" value={activeGroup.id !== "all" && groups.find((g) => g.id === activeGroup.id)?.memberCount ? groups.find((g) => g.id === activeGroup.id)!.memberCount! : total} sub={`${roles.member} thường · ${roles.admin} admin · ${roles.owner} owner`} />
        <Stat label="Mục tiêu giữ lại" value={target} sub={overTarget > 0 ? `vượt ${overTarget} người` : "đang ở/ dưới mục tiêu"} />
        <Stat
          label="Giai đoạn làm nóng"
          value={warmup.remaining > 0 ? `còn ${warmup.remaining} ngày` : "đã xong"}
          sub={warmup.startedAt ? `đã thu thập ${warmup.collected}/${warmupDays} ngày` : "chưa bắt đầu (bot chưa chạy)"}
        />
        <Stat label="Tổng tương tác đã ghi" value={interactions} sub="chat + reaction + vote" />
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
