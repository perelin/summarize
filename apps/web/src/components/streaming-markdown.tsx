import { useEffect, useRef } from "preact/hooks";
import { marked } from "marked";
import DOMPurify from "dompurify";

type Props = {
  text: string;
};

export function StreamingMarkdown({ text }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const html = DOMPurify.sanitize(marked.parse(text) as string);
    ref.current.innerHTML = html;
  }, [text]);

  return (
    <div
      ref={ref}
      class="markdown-body"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "14px",
        padding: "28px 24px",
        boxShadow: "var(--shadow-md)",
      }}
    />
  );
}
