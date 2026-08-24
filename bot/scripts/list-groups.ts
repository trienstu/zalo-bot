import { runListGroups } from "../src/commands/list-groups.js";

runListGroups().catch((err) => {
  console.error("Lỗi khi quét danh sách nhóm:", err);
  process.exit(1);
});
