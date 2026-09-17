import crypto from "node:crypto";

const HUB_SALT = process.env.HUB_SECRET || process.env.COOKIE_SECRET || "zalo_hub_secure_salt_2026";

/**
 * Sinh mã token bảo mật cho từng nhóm
 * Thành viên truy cập qua link kèm token này chỉ xem được đúng nhóm của họ
 */
export function getGroupHubToken(groupId: string): string {
  if (!groupId) return "";
  return crypto.createHmac("sha256", HUB_SALT).update(String(groupId)).digest("hex").slice(0, 16);
}

export function verifyGroupHubToken(groupId: string, token: string): boolean {
  if (!groupId || !token) return false;
  const expected = getGroupHubToken(groupId);
  return expected.toLowerCase() === token.trim().toLowerCase();
}
