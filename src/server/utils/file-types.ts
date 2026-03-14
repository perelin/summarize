import { extname } from "node:path";

export type UploadFileType = "pdf" | "image" | "audio" | "video";

interface FileTypeEntry {
  mimes: string[];
  exts: string[];
}

export const ALLOWED_UPLOAD_TYPES: Record<UploadFileType, FileTypeEntry> = {
  pdf: {
    mimes: ["application/pdf"],
    exts: [".pdf"],
  },
  image: {
    mimes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"],
    exts: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"],
  },
  audio: {
    mimes: [
      "audio/mpeg",
      "audio/mp4",
      "audio/x-m4a",
      "audio/mp4a-latm",
      "audio/wav",
      "audio/x-wav",
      "audio/flac",
      "audio/aac",
      "audio/ogg",
      "audio/opus",
    ],
    exts: [".mp3", ".m4a", ".wav", ".flac", ".aac", ".ogg", ".opus"],
  },
  video: {
    mimes: ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"],
    exts: [".mp4", ".mov", ".mkv", ".webm"],
  },
};

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * Detect the upload file type from a filename and optional MIME type.
 * Extension is checked first; MIME type is used as fallback.
 * Returns null if the file type is not supported.
 */
export function detectUploadType(filename: string, mimeType?: string): UploadFileType | null {
  const ext = extname(filename).toLowerCase();

  if (ext) {
    for (const [type, entry] of Object.entries(ALLOWED_UPLOAD_TYPES) as [UploadFileType, FileTypeEntry][]) {
      if (entry.exts.includes(ext)) {
        return type;
      }
    }
  }

  if (mimeType) {
    for (const [type, entry] of Object.entries(ALLOWED_UPLOAD_TYPES) as [UploadFileType, FileTypeEntry][]) {
      if (entry.mimes.includes(mimeType)) {
        return type;
      }
    }
  }

  return null;
}
