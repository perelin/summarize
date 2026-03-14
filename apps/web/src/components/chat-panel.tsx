import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  fetchChatHistory,
  streamChat,
  type ChatMessage,
} from "../lib/api.js";
import { StreamingMarkdown } from "./streaming-markdown.js";
import "../styles/markdown.css";

type Phase = "idle" | "streaming" | "error";

export function ChatPanel({ summaryId }: { summaryId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load chat history
  useEffect(() => {
    fetchChatHistory(summaryId)
      .then((data) => setMessages(data.messages))
      .catch(() => {
        // Chat history may not exist yet, that's fine
      });
  }, [summaryId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || phase === "streaming") return;

    setInput("");
    setPhase("streaming");
    setStreamingText("");
    setError("");

    // Optimistically add user message
    const userMsg: ChatMessage = {
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    controllerRef.current?.abort();
    controllerRef.current = streamChat(
      { summaryId, message: text },
      {
        onChunk: (chunk) => {
          setStreamingText((prev) => prev + chunk);
        },
        onDone: () => {
          setStreamingText((prev) => {
            // Add assistant message to history
            const assistantMsg: ChatMessage = {
              role: "assistant",
              content: prev,
              createdAt: new Date().toISOString(),
            };
            setMessages((msgs) => [...msgs, assistantMsg]);
            return "";
          });
          setPhase("idle");
        },
        onError: (message) => {
          setError(message);
          setPhase("error");
          setStreamingText("");
        },
      },
    );
  }, [input, phase, summaryId]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ marginTop: "24px" }}>
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontWeight: "400",
          fontSize: "1.15rem",
          marginBottom: "12px",
          color: "var(--text)",
        }}
      >
        Chat about this source
      </h3>

      {/* Messages */}
      {(messages.length > 0 || streamingText) && (
        <div
          ref={scrollRef}
          style={{
            maxHeight: "400px",
            overflowY: "auto" as const,
            marginBottom: "12px",
            display: "flex",
            flexDirection: "column" as const,
            gap: "12px",
          }}
        >
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}
          {streamingText && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "12px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <StreamingMarkdown text={streamingText} streaming />
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "8px 12px",
            fontSize: "13px",
            color: "var(--error-text)",
            background: "var(--error-bg)",
            border: "1px solid var(--error-border)",
            borderRadius: "8px",
            marginBottom: "12px",
          }}
        >
          {error}
        </div>
      )}

      {/* Input */}
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          type="text"
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the original source\u2026"
          disabled={phase === "streaming"}
          style={{
            flex: 1,
            padding: "10px 14px",
            fontSize: "15px",
            fontFamily: "var(--font-body)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            background: "var(--field-bg)",
            color: "var(--text)",
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={phase === "streaming" || !input.trim()}
          style={{
            padding: "10px 18px",
            fontSize: "14px",
            fontWeight: "600",
            fontFamily: "var(--font-body)",
            color: "var(--accent-text)",
            background: "var(--accent)",
            border: "none",
            borderRadius: "10px",
            cursor: phase === "streaming" ? "not-allowed" : "pointer",
            opacity: phase === "streaming" || !input.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: "12px",
        background: isUser ? "var(--panel)" : "var(--surface)",
        border: "1px solid var(--border)",
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "85%",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          fontWeight: "600",
          color: "var(--muted)",
          marginBottom: "4px",
          textTransform: "uppercase" as const,
          letterSpacing: "0.04em",
        }}
      >
        {isUser ? "You" : "Assistant"}
      </div>
      {isUser ? (
        <div style={{ fontSize: "14px", lineHeight: "1.6" }}>{message.content}</div>
      ) : (
        <StreamingMarkdown text={message.content} />
      )}
    </div>
  );
}
