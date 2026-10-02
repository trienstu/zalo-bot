export type KnowledgeCategory =
  | "ai_prompt"
  | "tools_tech"
  | "business_real_estate"
  | "tips_workflow"
  | "news_insight"
  | "trading_signals"
  | "technical_analysis"
  | "macro_news"
  | "risk_psychology"
  | "shared_files"
  | "general";

export interface TrackedChat {
  chat_id: string;
  title: string;
  username: string | null;
  chat_type: "group" | "supergroup" | "channel";
  is_tracked: number; // 1 = active, 0 = paused
  last_message_id: number;
  total_messages: number;
  joined_at: number;
  updated_at: number;
}

export interface TelegramRawMessage {
  id?: number;
  chat_id: string;
  message_id: number;
  sender_id: string | null;
  sender_name: string | null;
  sender_username: string | null;
  message_text: string;
  media_type: "none" | "photo" | "video" | "document";
  media_caption: string;
  file_name?: string | null;
  file_size?: number | null;
  reply_to_msg_id: number | null;
  telegram_url?: string | null;
  date: number; // Unix timestamp (giây) của tin nhắn trên Telegram
  created_at: number; // Epoch ms khi lưu vào DB
}

export interface TelegramKnowledgeItem {
  id?: number;
  chat_id: string;
  category: KnowledgeCategory;
  title: string;
  summary: string;
  key_takeaways: string[];
  original_quotes?: string;
  original_content?: string;
  useful_links: string[];
  raw_message_ids: number[];
  telegram_url?: string | null;
  date_range: string;
  created_at: number;
  updated_at: number;
  chat_title?: string;
}

export interface TelegramExportJob {
  id?: number;
  title: string;
  file_name: string;
  file_path: string;
  file_size: number;
  item_count: number;
  filter_category?: string;
  filter_days?: number;
  created_at: number;
}
