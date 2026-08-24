import { getDb } from "../src/db/index.js";

const db = getDb();
console.log("=== TOTAL MEMBERS ===", db.prepare("SELECT count(*) as cnt FROM members").get());
console.log("=== INTERACTIONS BY TYPE ===");
console.log(db.prepare("SELECT type, count(*) as count, count(distinct zalo_user_id) as users FROM interactions GROUP BY type").all());
console.log("=== TOP 10 LEADERBOARD SQL ===");
console.log(db.prepare(`
  SELECT m.display_name, m.zalo_user_id,
         SUM(CASE i.type WHEN 'message' THEN 10 WHEN 'image' THEN 10 WHEN 'video' THEN 10 WHEN 'vote' THEN 3 WHEN 'reaction' THEN 1 ELSE 0 END) as score,
         SUM(CASE WHEN i.type = 'message' THEN 1 ELSE 0 END) as msg_cnt,
         SUM(CASE WHEN i.type = 'vote' THEN 1 ELSE 0 END) as vote_cnt,
         SUM(CASE WHEN i.type = 'reaction' THEN 1 ELSE 0 END) as react_cnt
  FROM members m
  JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
  WHERE m.is_active = 1
  GROUP BY m.zalo_user_id
  ORDER BY score DESC LIMIT 10
`).all());
console.log("=== GROUP MESSAGES BY USER ===");
console.log(db.prepare("SELECT display_name, zalo_user_id, count(*) as cnt FROM group_messages GROUP BY zalo_user_id ORDER BY cnt DESC LIMIT 10").all());
