export type InputMode = "empty" | "url" | "text" | "file";
export type FileCategory = "pdf" | "image" | "audio" | "video";

const EXT_TO_CATEGORY: Record<string, FileCategory> = {
  ".pdf": "pdf",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
  ".mp3": "audio",
  ".m4a": "audio",
  ".wav": "audio",
  ".flac": "audio",
  ".aac": "audio",
  ".ogg": "audio",
  ".opus": "audio",
  ".mp4": "video",
  ".mov": "video",
  ".mkv": "video",
  ".webm": "video",
};

export const ACCEPT_STRING = Object.keys(EXT_TO_CATEGORY).join(",");
export const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB

export function getFileCategory(file: File): FileCategory | null {
  const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "");
  if (ext in EXT_TO_CATEGORY) return EXT_TO_CATEGORY[ext];
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

export function isAllowedFile(file: File): boolean {
  return getFileCategory(file) !== null;
}

const URL_REGEX = /^https?:\/\/\S+$/;

export function detectInputMode(text: string, file: File | null): InputMode {
  if (file) return "file";
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (URL_REGEX.test(trimmed)) return "url";
  return "text";
}

export function getCategoryIcon(category: FileCategory): string {
  switch (category) {
    case "pdf":
      return "\u{1F4C4}";
    case "image":
      return "\u{1F5BC}\uFE0F";
    case "audio":
      return "\u{1F3B5}";
    case "video":
      return "\u{1F3AC}";
  }
}

export function getCategoryLabel(category: FileCategory): string {
  switch (category) {
    case "pdf":
      return "PDF";
    case "image":
      return "Image";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
  }
}
