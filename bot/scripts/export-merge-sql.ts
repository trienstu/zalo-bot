import { getDb } from "../src/db/index.js";
import fs from "node:fs";

const db = getDb();

const members = db.prepare("SELECT * FROM members").all();
const interactions = db.prepare("SELECT * FROM interactions").all();
const messages = db.prepare("SELECT * FROM group_messages").all();
const media = db.prepare("SELECT * FROM group_media_events").all();
const summaries = db.prepare("SELECT * FROM daily_summaries").all();

const sqlLines: string[] = ["BEGIN TRANSACTION;"];

// 1. Members
for (const m of members as any[]) {
  sqlLines.push(
    `INSERT INTO members (zalo_user_id, display_name, role, is_active, joined_at, first_seen_at, last_seen_at, updated_at) ` +
    `VALUES (${q(m.zalo_user_id)}, ${q(m.display_name)}, ${q(m.role)}, ${m.is_active}, ${m.joined_at}, ${m.first_seen_at}, ${m.last_seen_at}, ${m.updated_at}) ` +
    `ON CONFLICT(zalo_user_id) DO UPDATE SET display_name = excluded.display_name, is_active = 1, updated_at = excluded.updated_at;`
  );
}

// 2. Interactions
for (const i of interactions as any[]) {
  sqlLines.push(
    `INSERT OR IGNORE INTO interactions (zalo_user_id, type, ts, source, created_at) ` +
    `VALUES (${q(i.zalo_user_id)}, ${q(i.type)}, ${i.ts}, ${q(i.source)}, ${i.created_at});`
  );
}

// 3. Messages
for (const msg of messages as any[]) {
  sqlLines.push(
    `INSERT OR IGNORE INTO group_messages (thread_id, message_id, zalo_user_id, display_name, text, msg_type, ts, is_self, created_at, deleted_at, deleted_source) ` +
    `VALUES (${q(msg.thread_id)}, ${q(msg.message_id)}, ${q(msg.zalo_user_id)}, ${q(msg.display_name)}, ${q(msg.text)}, ${q(msg.msg_type)}, ${msg.ts}, ${msg.is_self}, ${msg.created_at}, ${msg.deleted_at}, ${q(msg.deleted_source)});`
  );
}

// 4. Media
for (const md of media as any[]) {
  sqlLines.push(
    `INSERT OR IGNORE INTO group_media_events (thread_id, message_id, zalo_user_id, display_name, media_type, media_count, msg_type, ts, is_self, media_url, local_path, created_at, deleted_at, deleted_source) ` +
    `VALUES (${q(md.thread_id)}, ${q(md.message_id)}, ${q(md.zalo_user_id)}, ${q(md.display_name)}, ${q(md.media_type)}, ${md.media_count}, ${q(md.msg_type)}, ${md.ts}, ${md.is_self}, ${q(md.media_url)}, ${q(md.local_path)}, ${md.created_at}, ${md.deleted_at}, ${q(md.deleted_source)});`
  );
}

// 5. Summaries
for (const s of summaries as any[]) {
  sqlLines.push(
    `INSERT OR IGNORE INTO daily_summaries (day_date, day_label, summary_text, total_messages, unique_senders, images, videos, created_at) ` +
    `VALUES (${q(s.day_date)}, ${q(s.day_label)}, ${q(s.summary_text)}, ${s.total_messages}, ${s.unique_senders}, ${s.images}, ${s.videos}, ${s.created_at});`
  );
}

sqlLines.push("COMMIT;");

function q(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

fs.writeFileSync("/Volumes/SSD NVME/BOT MEMBER ZALO/merge-localhost-data.sql", sqlLines.join("\n"));
console.log(`Exported ${members.length} members, ${interactions.length} interactions, ${messages.length} messages to merge-localhost-data.sql!`);
