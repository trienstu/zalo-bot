import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getGroupHubToken, verifyGroupHubToken } from "@/lib/hub-token";

export const dynamic = "force-dynamic";

function getBotDbPath(): string {
  const possiblePaths = [
    process.env.SQLITE_DB_PATH,
    path.resolve(process.cwd(), "data", "bot.db"),
    path.resolve(process.cwd(), "..", "bot", "data", "bot.db"),
    path.resolve(process.cwd(), "bot", "data", "bot.db"),
    path.resolve(process.cwd(), "..", "data", "bot.db"),
  ].filter(Boolean) as string[];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.resolve(process.cwd(), "..", "bot", "data", "bot.db");
}

function ensureTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      description TEXT,
      stars INTEGER DEFAULT 0,
      forks INTEGER DEFAULT 0,
      language TEXT,
      category TEXT NOT NULL,
      summary_vi TEXT,
      target_audience TEXT,
      shared_by_uid TEXT,
      shared_by_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(thread_id, full_name)
    );
    CREATE INDEX IF NOT EXISTS idx_group_repos_thread ON group_repos(thread_id);
    CREATE INDEX IF NOT EXISTS idx_group_repos_category ON group_repos(category);
    CREATE INDEX IF NOT EXISTS idx_group_repos_created ON group_repos(created_at DESC);
  `);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let requestedGroupId = searchParams.get("groupId") || searchParams.get("threadId") || "all";
    const token = searchParams.get("token") || "";
    const category = searchParams.get("category") || "all";
    const search = (searchParams.get("q") || searchParams.get("search") || "").trim();
    const sort = searchParams.get("sort") || "stars";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.max(1, Math.min(60, parseInt(searchParams.get("limit") || "24", 10)));
    const offset = (page - 1) * limit;

    const dbPath = getBotDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({
        repos: [],
        categories: [],
        groups: [],
        pagination: { page: 1, limit, total: 0, totalPages: 0 },
        stats: { totalRepos: 0, totalStars: 0 },
        isLockedGroup: false,
        isAdmin: false,
      });
    }

    // Kiểm tra bảo mật:
    // - Nếu có token: Cho phép thành viên vào nhóm riêng được ủy quyền
    // - Nếu không có token: Bắt buộc phải là Admin (đã đăng nhập qua cookie hoặc x-admin-auth header) hoặc đang truy cập từ Localhost máy chủ
    const cookieHeader = request.headers.get("cookie") || "";
    const xAdminAuth = request.headers.get("x-admin-auth") || "";
    const isAdminAuthenticated =
      cookieHeader.includes("admin_auth_session=authenticated_admin") ||
      xAdminAuth === "authenticated_admin";
    const host = request.headers.get("host") || "";
    const isDevLocalhost =
      process.env.NODE_ENV === "development" &&
      (host.startsWith("localhost") || host.startsWith("127.0.0.1"));
    const isAdmin = isAdminAuthenticated || isDevLocalhost;

    if (!token && !isAdmin) {
      return NextResponse.json(
        {
          error: "unauthorized",
          message: "Kho tài nguyên GitHub chỉ dành cho Quản trị viên. Thành viên vui lòng dùng link chia sẻ riêng của nhóm.",
          repos: [],
          categories: [],
          groups: [],
          pagination: { page: 1, limit, total: 0, totalPages: 0 },
          stats: { totalRepos: 0, totalStars: 0 },
          isLockedGroup: true,
          needAdminAuth: true,
          isAdmin: false,
        },
        { status: 401 }
      );
    }

    const db = new Database(dbPath, { readonly: false });
    ensureTable(db);

    // Kiểm tra token nhóm bảo mật (Chế độ thành viên Zalo truy cập link nhóm)
    let isLockedGroup = false;
    let currentGroup: { id: string; name: string; token: string } | null = null;

    if (token) {
      if (!requestedGroupId || requestedGroupId === "all" || !verifyGroupHubToken(requestedGroupId, token)) {
        db.close();
        return NextResponse.json(
          {
            error: "Đường link không hợp lệ hoặc bạn không có quyền truy cập nhóm này.",
            repos: [],
            categories: [],
            groups: [],
            pagination: { page: 1, limit, total: 0, totalPages: 0 },
            stats: { totalRepos: 0, totalStars: 0 },
            isLockedGroup: true,
            isAdmin,
          },
          { status: 403 }
        );
      }
      isLockedGroup = true;
      const gRow: any = db.prepare("SELECT group_id, name FROM bot_groups WHERE group_id = ?").get(requestedGroupId);
      currentGroup = {
        id: requestedGroupId,
        name: gRow?.name || "Nhóm riêng",
        token,
      };
    }

    const conditions: string[] = [];
    const params: any[] = [];

    // Nếu có khóa nhóm (thành viên) hoặc admin chọn nhóm cụ thể
    const effectiveGroupId = isLockedGroup ? requestedGroupId : requestedGroupId;
    if (effectiveGroupId && effectiveGroupId !== "all") {
      conditions.push("gr.thread_id = ?");
      params.push(effectiveGroupId);
    }

    if (category && category !== "all") {
      conditions.push("gr.category = ?");
      params.push(category);
    }

    if (search) {
      conditions.push("(gr.full_name LIKE ? OR gr.description LIKE ? OR gr.summary_vi LIKE ? OR gr.language LIKE ? OR gr.target_audience LIKE ? OR bg.name LIKE ?)");
      const term = `%${search}%`;
      params.push(term, term, term, term, term, term);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Sắp xếp
    let orderClause = "ORDER BY gr.stars DESC, gr.created_at DESC";
    if (sort === "newest") {
      orderClause = "ORDER BY gr.created_at DESC";
    } else if (sort === "forks") {
      orderClause = "ORDER BY gr.forks DESC, gr.created_at DESC";
    } else if (sort === "name") {
      orderClause = "ORDER BY gr.full_name ASC";
    } else if (sort === "oldest") {
      orderClause = "ORDER BY gr.created_at ASC";
    }

    // Đếm tổng số duy nhất (chống liệt kê trùng lặp repo không phân biệt hoa thường)
    const countSql = `
      SELECT COUNT(DISTINCT LOWER(gr.full_name)) as total 
      FROM group_repos gr
      LEFT JOIN bot_groups bg ON bg.group_id = gr.thread_id
      ${whereClause}
    `;
    const countRow: any = db.prepare(countSql).get(...params);
    const total = countRow?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Lấy danh sách repos kèm tên nhóm Zalo (Deduplication: mỗi full_name duy nhất 1 thẻ không phân biệt hoa thường)
    const dataSql = `
      SELECT 
        MIN(sub.id) as id,
        sub.repo_url,
        sub.owner,
        sub.repo_name,
        sub.full_name,
        sub.description,
        MAX(sub.stars) as stars,
        MAX(sub.forks) as forks,
        sub.language,
        sub.category,
        sub.summary_vi,
        sub.target_audience,
        sub.shared_by_uid,
        sub.shared_by_name,
        MAX(sub.created_at) as created_at,
        MAX(sub.updated_at) as updated_at,
        GROUP_CONCAT(DISTINCT COALESCE(sub.b_name, 'Nhóm Zalo')) as group_name
      FROM (
        SELECT gr.*, bg.name as b_name
        FROM group_repos gr
        LEFT JOIN bot_groups bg ON bg.group_id = gr.thread_id
        ${whereClause}
        ORDER BY gr.stars DESC, LENGTH(COALESCE(gr.summary_vi, '')) DESC
      ) sub
      GROUP BY LOWER(sub.full_name)
      ${orderClause.replace(/gr\./g, "sub.")}
      LIMIT ? OFFSET ?
    `;
    const repos = db.prepare(dataSql).all(...params, limit, offset);

    // Thống kê categories cho filter pills (chỉ đếm distinct repo không phân biệt hoa thường)
    const catSql = `
      SELECT category, COUNT(DISTINCT LOWER(full_name)) as count 
      FROM group_repos gr
      ${effectiveGroupId && effectiveGroupId !== "all" ? "WHERE gr.thread_id = ?" : ""}
      GROUP BY category 
      ORDER BY count DESC
    `;
    const categories = effectiveGroupId && effectiveGroupId !== "all" 
      ? db.prepare(catSql).all(effectiveGroupId)
      : db.prepare(catSql).all();

    // Thống kê danh sách các nhóm Zalo có repos hoặc đang quản lý (Chỉ tiết lộ cho Admin)
    let groups: { id: string; name: string; repoCount: number; token?: string }[] = [];
    if (isAdmin) {
      const groupSql = `
        SELECT bg.group_id as id, bg.name, COUNT(DISTINCT LOWER(gr.full_name)) as repoCount
        FROM bot_groups bg
        LEFT JOIN group_repos gr ON gr.thread_id = bg.group_id
        GROUP BY bg.group_id
        ORDER BY repoCount DESC, bg.name ASC
      `;
      const rawGroups: any[] = db.prepare(groupSql).all();
      groups = rawGroups.map((g) => ({
        id: g.id,
        name: g.name,
        repoCount: Number(g.repoCount) || 0,
        token: getGroupHubToken(g.id),
      }));
    } else if (isLockedGroup && currentGroup) {
      // Thành viên xem qua link nhóm chỉ nhận thông tin của nhóm mình được cấp phép
      groups = [
        {
          id: currentGroup.id,
          name: currentGroup.name,
          repoCount: total,
          token: currentGroup.token,
        },
      ];
    }

    // Thống kê tổng số repo duy nhất và tổng stars
    const statRow: any = db.prepare(`
      SELECT COUNT(*) as totalRepos, COALESCE(SUM(stars), 0) as totalStars 
      FROM (
        SELECT LOWER(full_name), MAX(stars) as stars
        FROM group_repos
        ${effectiveGroupId && effectiveGroupId !== "all" ? "WHERE thread_id = ?" : ""}
        GROUP BY LOWER(full_name)
      )
    `).get(...(effectiveGroupId && effectiveGroupId !== "all" ? [effectiveGroupId] : []));

    db.close();

    return NextResponse.json({
      repos,
      categories,
      groups,
      isLockedGroup,
      currentGroup,
      isAdmin,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      stats: {
        totalRepos: statRow?.totalRepos || 0,
        totalStars: statRow?.totalStars || 0,
      },
    });
  } catch (err: any) {
    console.error("[api/repos] Error:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error", repos: [] }, { status: 500 });
  }
}
