import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Clock3, MessageCircle, Trophy, UserX, Star, Search, Shield, User, Sparkles } from "lucide-react";
import { dbExists, listLeaderboard, listMemberStatsFiltered, type LeaderboardPeriod } from "@/lib/db";
import { readVip } from "@/lib/vip";
import { fmtAgo, fmtDateTime } from "@/lib/utils";
import { VipToggleButton } from "../members/vip-toggle-button";
import { Badge, Input } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bảng xếp hạng & Quản lý tương tác",
  description: "Bảng xếp hạng top thành viên tích cực và danh sách thành viên không tương tác trong cộng đồng.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
  },
};

type SearchParams = Record<string, string | string[] | undefined>;

const PERIODS: { value: LeaderboardPeriod; label: string; description: string }[] = [
  { value: "7d", label: "7 ngày", description: "7 ngày gần nhất" },
  { value: "30d", label: "30 ngày", description: "30 ngày gần nhất" },
  { value: "all", label: "Toàn thời gian", description: "Từ khi bot bắt đầu ghi nhận" },
];

function readPeriod(params: SearchParams | undefined): LeaderboardPeriod {
  const raw = params?.period;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "7d" || value === "30d" || value === "all" ? value : "7d";
}

function one(params: SearchParams | undefined, key: string): string {
  const value = params?.[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function rankStyle(rank: number): string {
  if (rank === 1) return "border-amber-400 bg-amber-400/20 text-amber-300 shadow-md shadow-amber-400/20";
  if (rank === 2) return "border-slate-300 bg-slate-300/20 text-slate-100 shadow-md shadow-slate-300/20";
  if (rank === 3) return "border-orange-500 bg-orange-500/20 text-orange-300 shadow-md shadow-orange-500/20";
  return "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]";
}

function rankTrophyBadge(rank: number) {
  if (rank === 1) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-gradient-to-r from-amber-500/20 to-yellow-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-300 shadow-sm shadow-amber-400/20">
        <Trophy className="h-3.5 w-3.5 fill-amber-400 text-amber-400 animate-pulse" />
        <span>🏆 Quán quân</span>
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300/40 bg-gradient-to-r from-slate-400/20 to-slate-200/10 px-2.5 py-0.5 text-xs font-bold text-slate-200 shadow-sm shadow-slate-300/20">
        <Trophy className="h-3.5 w-3.5 fill-slate-300 text-slate-300" />
        <span>🥈 Á quân</span>
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/40 bg-gradient-to-r from-orange-600/20 to-amber-600/10 px-2.5 py-0.5 text-xs font-bold text-orange-300 shadow-sm shadow-orange-500/20">
        <Trophy className="h-3.5 w-3.5 fill-orange-400 text-orange-400" />
        <span>🥉 Quý quân</span>
      </span>
    );
  }
  return null;
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const currentTab = one(params, "tab") === "inactive" ? "inactive" : "active";
  const period = readPeriod(params);
  const activePeriod = PERIODS.find((item) => item.value === period) ?? PERIODS[0];
  const q = one(params, "q").trim();

  const inactiveFilter = (one(params, "filter") || "inactive7") as "inactive7" | "inactive30" | "zero";

  const rows = dbExists() ? listLeaderboard(period, 50) : [];
  const vipMap = new Set(readVip().map((v) => v.id));

  // Lấy danh sách thành viên không tương tác theo bộ lọc đã chọn
  const inactiveMembers = dbExists()
    ? listMemberStatsFiltered({ activity: inactiveFilter, q, limit: 1000 })
    : [];

  const totalInactive = inactiveMembers.length;
  const inactiveAdmins = inactiveMembers.filter((m) => m.role === "admin" || m.role === "owner").length;
  const inactiveVips = inactiveMembers.filter((m) => vipMap.has(m.zalo_user_id)).length;
  const inactiveWarned = inactiveMembers.filter((m) => m.warning_count > 0).length;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(79,140,255,0.16),_transparent_38%),var(--color-bg)]">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_16%,transparent)] text-[var(--color-primary)]">
            {currentTab === "active" ? <Trophy size={28} /> : <UserX size={28} />}
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            {currentTab === "active" ? "Bảng xếp hạng tương tác" : "Thành viên không tương tác"}
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--color-muted)] sm:text-base">
            {currentTab === "active"
              ? "Vinh danh những thành viên hoạt động sôi nổi và đóng góp nhiều nhất cho cộng đồng."
              : "Danh sách các thành viên chưa có tin nhắn hoặc tương tác để quản lý, nhắc nhở hoặc gắn VIP."}
          </p>
        </header>

        {/* Tab chuyển đổi lớn: Top tương tác vs Không tương tác */}
        <div className="mx-auto mt-7 flex max-w-md items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5">
          <Link
            href={`/leaderboard?tab=active&period=${period}`}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-all ${
              currentTab === "active"
                ? "bg-[var(--color-primary)] text-white shadow-md shadow-blue-500/20"
                : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            }`}
          >
            <Trophy className="h-4 w-4" />
            <span>Top tương tác</span>
          </Link>
          <Link
            href="/leaderboard?tab=inactive"
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-all ${
              currentTab === "inactive"
                ? "bg-rose-600 text-white shadow-md shadow-rose-500/20"
                : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            }`}
          >
            <UserX className="h-4 w-4" />
            <span>0 Tương tác ({totalInactive})</span>
          </Link>
        </div>

        {/* NỘI DUNG TAB 1: TOP TƯƠNG TÁC */}
        {currentTab === "active" && (
          <>
            <nav className="mx-auto mt-6 grid max-w-xl grid-cols-3 gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5">
              {PERIODS.map((item) => {
                const active = item.value === period;
                return (
                  <Link
                    key={item.value}
                    href={`/leaderboard?tab=active&period=${item.value}`}
                    className={`rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
                      active
                        ? "bg-[var(--color-surface-2)] text-[var(--color-text)] font-semibold border border-[var(--color-border)]"
                        : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-8 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] shadow-2xl shadow-black/20">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
                <div>
                  <h2 className="font-semibold flex items-center gap-2">
                    <span>Top 50 · {activePeriod.label}</span>
                    <Sparkles className="h-4 w-4 text-amber-400" />
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {activePeriod.description}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <BarChart3 size={15} />
                  Cập nhật theo dữ liệu mới nhất
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <MessageCircle className="mx-auto text-[var(--color-muted)]" size={34} />
                  <p className="mt-3 font-medium">Chưa có tương tác trong khoảng thời gian này</p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    Bảng xếp hạng sẽ tự xuất hiện khi bot ghi nhận dữ liệu mới.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--color-border)]">
                  {rows.map((row) => (
                    <div
                      key={`${row.rank}-${row.display_name}`}
                      className={`grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 transition-colors sm:grid-cols-[52px_minmax(0,1fr)_minmax(230px,auto)_90px] sm:px-6 ${
                        row.rank === 1
                          ? "bg-amber-400/[0.04] hover:bg-amber-400/[0.08]"
                          : row.rank === 2
                            ? "bg-slate-400/[0.03] hover:bg-slate-400/[0.06]"
                            : row.rank === 3
                              ? "bg-orange-500/[0.03] hover:bg-orange-500/[0.06]"
                              : "hover:bg-white/[0.025]"
                      }`}
                    >
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-bold ${rankStyle(row.rank)}`}
                      >
                        {row.rank}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="truncate font-medium text-base">
                            {row.display_name || "Thành viên ẩn danh"}
                          </span>
                          {rankTrophyBadge(row.rank)}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                          <Clock3 size={12} />
                          Tương tác {fmtAgo(row.last_interaction)}
                        </div>
                      </div>

                      <div className="hidden items-center justify-end gap-4 text-xs text-[var(--color-muted)] sm:flex">
                        <span title="Tin nhắn" className="bg-[var(--color-surface-2)] px-2 py-0.5 rounded text-[var(--color-text)]">
                          {row.message_count} tin
                        </span>
                        <span title="Reaction" className="bg-[var(--color-surface-2)] px-2 py-0.5 rounded text-[var(--color-text)]">
                          {row.reaction_count} reaction
                        </span>
                        <span title="Bình chọn" className="bg-[var(--color-surface-2)] px-2 py-0.5 rounded text-[var(--color-text)]">
                          {row.vote_count} vote
                        </span>
                        {row.other_count > 0 ? (
                          <span title="Tương tác khác" className="bg-[var(--color-surface-2)] px-2 py-0.5 rounded text-[var(--color-muted)]">
                            {row.other_count} khác
                          </span>
                        ) : null}
                      </div>

                      <div className="text-right">
                        <div className={`text-lg font-bold tabular-nums ${row.rank === 1 ? "text-amber-300" : row.rank === 2 ? "text-slate-200" : row.rank === 3 ? "text-orange-300" : "text-[var(--color-primary)]"}`}>
                          {row.interaction_count}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                          điểm
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <footer className="mt-5 text-center text-xs leading-5 text-[var(--color-muted)]">
              Điểm tương tác có trọng số: 1 tin nhắn/ảnh/video = 10 điểm, 1 lượt bình chọn = 3 điểm, 1 reaction = 1 điểm.
              <br />
              “Toàn thời gian” được tính từ lúc hệ thống bắt đầu thu thập dữ liệu.
            </footer>
          </>
        )}

        {/* NỘI DUNG TAB 2: THÀNH VIÊN KHÔNG TƯƠNG TÁC */}
        {currentTab === "inactive" && (
          <div className="mt-8 flex flex-col gap-6">
            {/* Thống kê thành viên 0 tương tác */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
                <div className="text-2xl font-bold text-rose-400">{totalInactive}</div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">Tổng 0 tương tác</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
                <div className="text-2xl font-bold text-amber-400">{inactiveVips}</div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">Đã gắn VIP (Miễn lọc)</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
                <div className="text-2xl font-bold text-blue-400">{inactiveAdmins}</div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">Admin / Chủ nhóm</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
                <div className="text-2xl font-bold text-orange-400">{inactiveWarned}</div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">Đã cảnh báo</div>
              </div>
            </div>

            {/* Bộ lọc phạm vi im lặng */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--color-muted)] font-medium">Lọc theo:</span>
              <Link
                href={`/leaderboard?tab=inactive&filter=inactive7${q ? `&q=${q}` : ""}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  inactiveFilter === "inactive7"
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 font-semibold"
                    : "bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)]"
                }`}
              >
                💤 Im lặng 7 ngày qua
              </Link>
              <Link
                href={`/leaderboard?tab=inactive&filter=inactive30${q ? `&q=${q}` : ""}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  inactiveFilter === "inactive30"
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 font-semibold"
                    : "bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)]"
                }`}
              >
                😴 Im lặng 30 ngày qua
              </Link>
              <Link
                href={`/leaderboard?tab=inactive&filter=zero${q ? `&q=${q}` : ""}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  inactiveFilter === "zero"
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 font-semibold"
                    : "bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)]"
                }`}
              >
                🚫 0 tương tác hoàn toàn
              </Link>
            </div>

            {/* Tìm kiếm */}
            <form action="/leaderboard" method="GET" className="flex items-center gap-2">
              <input type="hidden" name="tab" value="inactive" />
              <input type="hidden" name="filter" value={inactiveFilter} />
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
                <Input
                  name="q"
                  defaultValue={q}
                  placeholder="Tìm theo tên hoặc Zalo UID..."
                  className="pl-9 text-xs"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
              >
                Tìm kiếm
              </button>
            </form>

            {/* Bảng danh sách thành viên không tương tác */}
            <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] shadow-2xl shadow-black/20">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
                <div>
                  <h2 className="font-semibold text-sm">Danh sách thành viên chưa tương tác</h2>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {q ? `Kết quả tìm kiếm cho "${q}" (${inactiveMembers.length} người)` : `Toàn bộ ${inactiveMembers.length} thành viên chưa gửi tin nhắn hoặc reaction`}
                  </p>
                </div>
                <Link
                  href="/members?activity=zero"
                  className="text-xs text-[var(--color-primary)] hover:underline font-medium"
                >
                  Quản lý đầy đủ tại trang Thành viên →
                </Link>
              </div>

              {inactiveMembers.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <UserX className="mx-auto text-[var(--color-muted)]" size={34} />
                  <p className="mt-3 font-medium">Không tìm thấy thành viên phù hợp</p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    Mọi thành viên đều đang có tương tác hoặc không khớp từ khoá tìm kiếm.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--color-border)] max-h-[600px] overflow-y-auto">
                  {inactiveMembers.map((m, idx) => {
                    const isVip = vipMap.has(m.zalo_user_id);
                    return (
                      <div
                        key={m.zalo_user_id}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.025] sm:px-6"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-xs font-semibold text-rose-400 border border-rose-500/20">
                            {idx + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">
                                {m.display_name || "(Không tên)"}
                              </span>
                              {m.role === "owner" ? (
                                <Badge tone="warn" className="text-[10px]">Chủ nhóm</Badge>
                              ) : m.role === "admin" ? (
                                <Badge tone="ok" className="text-[10px]">Phó nhóm</Badge>
                              ) : (
                                <Badge tone="muted" className="text-[10px]">Member</Badge>
                              )}
                              {isVip && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.2 text-[10px] font-semibold text-amber-300">
                                  <Star className="h-3 w-3 fill-amber-400" /> VIP
                                </span>
                              )}
                              {m.warning_count > 0 && (
                                <Badge tone="danger" className="text-[10px]">
                                  Đã cảnh báo {m.warning_count} lần
                                </Badge>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-xs text-[var(--color-muted)]">
                              <span>UID: <code className="text-[11px]">{m.zalo_user_id}</code></span>
                              <span>·</span>
                              <span>Thấy lần đầu: {fmtDateTime(m.first_seen_at)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 ml-auto">
                          <VipToggleButton
                            id={m.zalo_user_id}
                            displayName={m.display_name}
                            isVip={isVip}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
