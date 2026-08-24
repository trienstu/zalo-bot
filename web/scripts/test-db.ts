import { listLeaderboard, listMemberStatsFiltered, dbExists } from "../src/lib/db.js";

try {
  console.log("dbExists:", dbExists());
  console.log("7d:", listLeaderboard("7d", 10));
  console.log("all:", listLeaderboard("all", 10));
  console.log("inactive:", listMemberStatsFiltered({ activity: "inactive7", limit: 10 }));
} catch (e) {
  console.error("ERROR IN DB QUERY:", e);
}
