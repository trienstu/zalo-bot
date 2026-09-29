export type PendingActionType =
  | "profile_update"
  | "send_direct"
  | "send_group"
  | "broadcast"
  | "generate_music"
  | "create_presentation_video"
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
    /^(?:ok|oke|okie|ok em|ok nhé|ok nha|ok a|ok ạ|duyệt|duyet|duyệt đi|tiến hành|tien hanh|tiến hành đi|làm đi|lam di|làm luôn|chấp thuận|chấp nhận|xác nhận|đồng ý|dong y|yes|y|chốt|chot|chốt đi|thực hiện|thuc hien|thực hiện đi|gửi đi|gui di|triển đi|triển|cho đi)$/iu.test(clean) ||
    /^(?:tiến hành|làm|thực hiện|triển|duyệt)\s+(?:đi|luôn|nhé|nha)$/iu.test(clean)
  );
}

export function isCancelConfirmation(text: string): boolean {
  const clean = text.trim().toLowerCase().replace(/[!.,?]+$/, "").trim();
  return /^(?:hủy|huy|thôi|thoi|bỏ|bo|không|khong|ko|cancel|đừng|dung|bỏ qua|dừng|dung lai)$/iu.test(clean);
}
