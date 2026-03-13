import { useEffect, useState } from "preact/hooks";
import { fetchMe, type AccountInfo } from "./lib/api.js";
import { useRoute } from "./lib/router.js";
import { getToken } from "./lib/token.js";
import { SummarizeView } from "./components/summarize-view.js";
import { HistoryView } from "./components/history-view.js";
import { SummaryDetail } from "./components/summary-detail.js";
import { TokenInput } from "./components/token-input.js";
import { ThemeToggle } from "./components/theme-toggle.js";

export function App() {
  const route = useRoute();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const token = getToken();

  useEffect(() => {
    if (!token) {
      setAuthChecked(true);
      return;
    }
    fetchMe().then((info) => {
      setAccount(info);
      setAuthChecked(true);
    });
  }, [token]);

  if (!authChecked) {
    return (
      <div class="container">
        <header class="brand">
          <h1 class="brand-title">Summarize</h1>
        </header>
      </div>
    );
  }

  if (!token) {
    return (
      <div class="container">
        <header class="brand">
          <h1 class="brand-title">Summarize</h1>
          <p class="brand-tagline">Distill any URL or text into its essence.</p>
        </header>
        <TokenInput onAuthenticated={() => window.location.reload()} />
      </div>
    );
  }

  const renderView = () => {
    switch (route.view) {
      case "history":
        return <HistoryView />;
      case "summary":
        return <SummaryDetail id={route.id} />;
      case "summarize":
      default:
        return <SummarizeView />;
    }
  };

  return (
    <div class="container">
      <a href="#main" class="skip-link">
        Skip to content
      </a>

      <header class="brand">
        <div class="brand-header">
          <div>
            <h1 class="brand-title">
              <a href="#/" style={{ color: "inherit", textDecoration: "none" }}>
                Summarize
              </a>
            </h1>
            <p class="brand-tagline">Distill any URL or text into its essence.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {account?.account?.name && (
              <span class="account-greeting">Hi, {account.account.name}</span>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <nav style={{ display: "flex", gap: "2px", marginBottom: "24px" }}>
        <NavTab href="#/" active={route.view === "summarize"}>
          Summarize
        </NavTab>
        <NavTab href="#/history" active={route.view === "history"}>
          History
        </NavTab>
      </nav>

      <main id="main">{renderView()}</main>

      <footer class="colophon">
        <a href="https://summarize.sh" target="_blank" rel="noopener noreferrer">
          Summarize
        </a>
        {" \u2014 based on work by "}
        <a href="https://steipete.me" target="_blank" rel="noopener noreferrer">
          Peter Steinberger
        </a>
      </footer>
    </div>
  );
}

function NavTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: preact.ComponentChildren;
}) {
  return (
    <a
      href={href}
      style={{
        borderRadius: "8px",
        padding: "6px 16px",
        fontSize: "13px",
        fontWeight: active ? "700" : "500",
        fontFamily: "var(--font-body)",
        border: `1px solid ${active ? "var(--border)" : "transparent"}`,
        background: active ? "var(--surface)" : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        cursor: "pointer",
        transition: "color 180ms ease, background 180ms ease, border-color 180ms ease",
        letterSpacing: "0.01em",
        textDecoration: "none",
      }}
    >
      {children}
    </a>
  );
}
