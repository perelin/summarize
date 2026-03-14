import { useCallback, useRef, useState } from "preact/hooks";
import type { ApiLength } from "../lib/api.js";
import {
  ACCEPT_STRING,
  MAX_FILE_SIZE,
  detectInputMode,
  formatFileSize,
  getFileCategory,
  getCategoryIcon,
  getCategoryLabel,
  isAllowedFile,
  type FileCategory,
  type InputMode,
} from "../lib/file-utils.js";

export type SubmitPayload =
  | { mode: "url"; url: string }
  | { mode: "text"; text: string }
  | { mode: "file"; file: File };

type Props = {
  onSubmit: (payload: SubmitPayload) => void;
  disabled: boolean;
  length: ApiLength;
  onLengthChange: (l: ApiLength) => void;
};

export function UnifiedInput({ onSubmit, disabled, length, onLengthChange }: Props) {
  const [textValue, setTextValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileCategory, setFileCategory] = useState<FileCategory | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const mode = detectInputMode(textValue, file);

  const attachFile = useCallback((f: File) => {
    setFileError(null);
    if (!isAllowedFile(f)) {
      setFileError(`Unsupported file type: ${f.name}`);
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setFileError(`File is ${formatFileSize(f.size)} — max is 200 MB`);
      return;
    }
    const cat = getFileCategory(f);
    setFile(f);
    setFileCategory(cat);
    setTextValue("");
    if (cat === "image") {
      setThumbnailUrl(URL.createObjectURL(f));
    } else {
      setThumbnailUrl(null);
    }
  }, []);

  const removeFile = useCallback(() => {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    setFile(null);
    setFileCategory(null);
    setFileError(null);
    setThumbnailUrl(null);
  }, [thumbnailUrl]);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) attachFile(f);
    },
    [attachFile],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file") {
          e.preventDefault();
          const f = item.getAsFile();
          if (f) {
            const name = f.name === "image.png" || !f.name ? `Pasted image.${f.type.split("/")[1] || "png"}` : f.name;
            const renamed = new File([f], name, { type: f.type });
            attachFile(renamed);
          }
          return;
        }
      }
    },
    [attachFile],
  );

  const handleSubmit = useCallback(
    (e: Event) => {
      e.preventDefault();
      if (disabled) return;
      if (file) {
        onSubmit({ mode: "file", file });
      } else {
        const trimmed = textValue.trim();
        if (!trimmed) return;
        const m = detectInputMode(trimmed, null);
        if (m === "url") onSubmit({ mode: "url", url: trimmed });
        else onSubmit({ mode: "text", text: trimmed });
      }
    },
    [disabled, file, textValue, onSubmit],
  );

  const canSubmit = !disabled && mode !== "empty";

  return (
    <form
      onSubmit={handleSubmit}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        border: `2px ${dragging ? "dashed" : "solid"} ${dragging ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "16px",
        background: dragging ? "color-mix(in srgb, var(--accent) 5%, var(--panel))" : "var(--panel)",
        padding: "16px",
        display: "grid",
        gap: "12px",
        boxShadow: "var(--shadow-sm)",
        animation: "fadeInUp 600ms var(--ease-out-expo) 80ms both",
        transition: "border-color 200ms ease, background 200ms ease",
        position: "relative",
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_STRING}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) attachFile(f);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />

      {/* Drag overlay */}
      {dragging && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "14px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            zIndex: 10,
            background: "color-mix(in srgb, var(--panel) 90%, transparent)",
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: "32px" }}>{"\u{1F4E5}"}</span>
          <span style={{ color: "var(--accent)", fontSize: "15px", fontWeight: 600 }}>
            Drop to summarize
          </span>
          <span style={{ color: "var(--muted)", fontSize: "12px" }}>
            PDF, images, audio, or video up to 200 MB
          </span>
        </div>
      )}

      {/* Input area */}
      {file ? (
        <FileCard
          file={file}
          category={fileCategory}
          thumbnailUrl={thumbnailUrl}
          onRemove={removeFile}
        />
      ) : (
        <div style={{ position: "relative" }}>
          <textarea
            value={textValue}
            onInput={(e) => {
              setTextValue((e.target as HTMLTextAreaElement).value);
              setFileError(null);
            }}
            onPaste={handlePaste}
            placeholder="Paste a URL, drop a file, or type text to summarize..."
            aria-label="Content to summarize"
            disabled={disabled}
            style={{
              width: "100%",
              padding: "12px 14px",
              paddingBottom: "36px",
              fontSize: "15px",
              fontFamily: "var(--font-body)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              background: "var(--field-bg)",
              color: "var(--text)",
              outline: "none",
              minHeight: "100px",
              resize: "vertical",
              lineHeight: "1.55",
              opacity: dragging ? 0.3 : 1,
              transition: "opacity 200ms ease",
            }}
          />
          {/* Type badges + browse button */}
          <div
            style={{
              position: "absolute",
              bottom: "10px",
              left: "14px",
              right: "14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              pointerEvents: "none",
            }}
          >
            <div style={{ display: "flex", gap: "4px" }}>
              {(["PDF", "Images", "Audio", "Video"] as const).map((label) => (
                <span
                  key={label}
                  style={{
                    fontSize: "10px",
                    color: "var(--muted)",
                    padding: "2px 6px",
                    background: "var(--surface)",
                    borderRadius: "4px",
                    opacity: 0.7,
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                pointerEvents: "auto",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "3px 10px",
                fontSize: "12px",
                color: "var(--muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontFamily: "var(--font-body)",
              }}
            >
              {"\u{1F4CE}"} Browse
            </button>
          </div>
        </div>
      )}

      {/* File error */}
      {fileError && (
        <div
          style={{
            padding: "8px 12px",
            background: "var(--error-bg)",
            border: "1px solid var(--error-border)",
            borderRadius: "8px",
            color: "var(--error-text)",
            fontSize: "13px",
          }}
        >
          {fileError}
        </div>
      )}

      {/* Actions row */}
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <select
          value={length}
          onChange={(e) => onLengthChange((e.target as HTMLSelectElement).value as ApiLength)}
          aria-label="Summary length"
          style={{
            padding: "10px 14px",
            fontSize: "14px",
            fontFamily: "var(--font-body)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            background: "var(--field-bg)",
            color: "var(--text)",
            outline: "none",
            minWidth: "110px",
            cursor: "pointer",
          }}
        >
          <option value="tiny">Tiny</option>
          <option value="short">Short</option>
          <option value="medium">Medium</option>
          <option value="long">Long</option>
          <option value="xlarge">XLarge</option>
        </select>

        {mode === "url" && (
          <span
            style={{
              fontSize: "11px",
              color: "var(--accent)",
              background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              padding: "3px 8px",
              borderRadius: "10px",
              whiteSpace: "nowrap",
            }}
          >
            URL detected
          </span>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            flex: 1,
            padding: "10px 24px",
            fontSize: "15px",
            fontWeight: 700,
            fontFamily: "var(--font-body)",
            color: "var(--accent-text)",
            background: "var(--accent)",
            border: "none",
            borderRadius: "10px",
            cursor: canSubmit ? "pointer" : "not-allowed",
            opacity: canSubmit ? 1 : 0.4,
            letterSpacing: "0.01em",
          }}
        >
          Summarize_p2
        </button>
      </div>
    </form>
  );
}

function FileCard({
  file,
  category,
  thumbnailUrl,
  onRemove,
}: {
  file: File;
  category: FileCategory | null;
  thumbnailUrl: string | null;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "14px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        background: "var(--field-bg)",
      }}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt="Preview"
          style={{
            width: 48,
            height: 48,
            borderRadius: "8px",
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "8px",
            background: "var(--surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "22px",
          }}
        >
          {category ? getCategoryIcon(category) : "\u{1F4C1}"}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: "var(--text)",
            fontSize: "14px",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {file.name}
        </div>
        <div style={{ color: "var(--muted)", fontSize: "12px" }}>
          {category ? getCategoryLabel(category) : "File"} &middot; {formatFileSize(file.size)}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove file"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "4px 8px",
          color: "var(--muted)",
          cursor: "pointer",
          fontSize: "16px",
          lineHeight: 1,
        }}
      >
        {"\u2715"}
      </button>
    </div>
  );
}
