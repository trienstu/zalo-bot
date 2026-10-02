export type PendingActionType =
  | "profile_update"
  | "send_direct"
  | "send_group"
  | "broadcast"
  | "generate_music"
  | "create_presentation_video"
  | "create_motion_video"
  | "generate_file"
  | "kick_member"
  | "admin_command";

export interface PendingAction {
  id: string;
  type: PendingActionType;
  threadId: string;
  userId: string;
  userName?: string;
  timestamp: number;
  data: any;
  summary: string;
}

const pendingActions = new Map<string, PendingAction>();

export function getPendingActionKey(threadId: string, userId: string): string {
  return `${threadId || "direct"}:${userId || "unknown"}`;
}

export function setPendingAction(
  threadId: string,
  userId: string,
  action: Omit<PendingAction, "id" | "timestamp" | "threadId" | "userId">,
): PendingAction {
  const key = getPendingActionKey(threadId, userId);
  const fullAction: PendingAction = {
    ...action,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    threadId,
    userId,
    timestamp: Date.now(),
  };
  pendingActions.set(key, fullAction);
  return fullAction;
}

export function getPendingAction(threadId: string, userId: string, maxAgeMs = 10 * 60 * 1000): PendingAction | null {
  const key = getPendingActionKey(threadId, userId);
  const action = pendingActions.get(key);
  if (!action) return null;
  if (Date.now() - action.timestamp > maxAgeMs) {
    pendingActions.delete(key);
    return null;
  }
  return action;
}

export function clearPendingAction(threadId: string, userId: string): void {
  const key = getPendingActionKey(threadId, userId);
  pendingActions.delete(key);
}

export function isAffirmativeConfirmation(text: string): boolean {
  const clean = text.trim().toLowerCase().replace(/[!.,?]+$/, "").trim();
  return (
    /^(?:ok(?:ela|ay|e)?|okie|ừ|uh|da|dạ|vâng|vang|dc|được|chốt|chot|nhất\s*trí|duyệt|duyet|tiến\s*hành|tien\s*hanh|triển\s*khai|trien\s*khai|triển|trien|làm|lam|chấp\s*thuận|chấp\s*nhận|xác\s*nhận|đồng\s*ý|dong\s*y|yes|y|thực\s*hiện|thuc\s*hien|gửi|cho\s*đi)(?:[\s,.:;!-]+(?:soạn|làm|tạo|xuất|viết|triển|lên|vẽ|sinh|chạy|tiến\s*hành|thực\s*hiện|gửi))?(?:[\s,.:;!-]+(?:luôn|ngay|hộ|giúp|cho|đi|nhé|nha|e|em|tiếp|nào|ạ|a|ơi))*$/iu.test(
      clean,
    )
  );
}

export function isCancelConfirmation(text: string): boolean {
  const clean = text.trim().toLowerCase().replace(/[!.,?]+$/, "").trim();
  return (
    /^(?:hủy|huy|thôi|thoi|bỏ|bo|không|khong|ko|cancel|đừng|dung|bỏ qua|dừng|dung lai)(?:[\s,.:;!-]+(?:đi|nào|nhé|nha|ạ|a|ơi|thôi|luôn))?$/iu.test(clean) ||
    /(?:rút\s+điện|đâu\s+cần|không\s+cần|ko\s+cần|thôi\s+khỏi|đừng\s+làm|dừng\s+lại|hủy\s+bỏ|hủy\s+tiến\s*trình)/iu.test(clean)
  );
}
