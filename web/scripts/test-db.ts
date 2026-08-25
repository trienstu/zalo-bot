import { listLeaderboard, listMemberStatsFiltered, listManagedGroups, dbExists } from "../src/lib/db.js";

try {
  console.log("dbExists:", dbExists());
  console.log("Groups:", listManagedGroups());
  console.log("Leaderboard Group 1 (1913869945242410752):", listLeaderboard("7d", 5, "1913869945242410752"));
  console.log("Leaderboard Group 2 (6918708484908920459):", listLeaderboard("7d", 5, "6918708484908920459"));
  console.log("Leaderboard All Groups:", listLeaderboard("7d", 5, "all"));
} catch (e) {
  console.error("ERROR IN DB QUERY:", e);
}

