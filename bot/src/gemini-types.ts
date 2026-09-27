export interface GeminiImagePart {
  data: string; // Base64 string
  mimeType: string; // e.g. 'image/jpeg', 'image/png', 'application/pdf', 'audio/mp3'
}

export type GeminiMediaPart = GeminiImagePart;
