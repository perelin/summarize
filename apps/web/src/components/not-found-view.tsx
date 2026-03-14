import { Link } from "../lib/router.js";

export function NotFoundView() {
  return (
    <div style={{ textAlign: "center", padding: "48px 0" }}>
      <h2 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "8px" }}>
        Summary not found
      </h2>
      <p style={{ fontSize: "14px", color: "var(--muted)", marginBottom: "24px", lineHeight: "1.5" }}>
        This summary may have expired or the link may be incorrect.
      </p>
      <Link
        href="/"
        style={{
          padding: "8px 16px",
          fontSize: "14px",
          fontWeight: "600",
          fontFamily: "var(--font-body)",
          color: "var(--accent-text)",
          background: "var(--accent)",
          border: "none",
          borderRadius: "8px",
          textDecoration: "none",
          display: "inline-block",
        }}
      >
        Create a new summary
      </Link>
    </div>
  );
}
