import { useEffect, useState } from "preact/hooks";
import { HistoryView } from "./components/history-view.js";
import { ProcessView } from "./components/process-view.js";
import { SettingsPanel } from "./components/settings-panel.js";
import { SummarizeView } from "./components/summarize-view.js";
import { ThemeToggle } from "./components/theme-toggle.js";
import { TokenInput } from "./components/token-input.js";
import { fetchDefaultToken, fetchMe, type AccountInfo } from "./lib/api.js";
import { useRoute, Link } from "./lib/router.js";
import { clearToken, getToken, setToken } from "./lib/token.js";

export function App() {
  const route = useRoute();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [token, setTokenState] = useState(() => getToken());
  const [manualLogout, setManualLogout] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Listen for open-settings event from DiscussIn component
  useEffect(() => {
    const handler = () => setShowSettings(true);
    window.addEventListener("open-settings", handler);
    return () => window.removeEventListener("open-settings", handler);
  }, []);

  useEffect(() => {
    if (!token) {
      if (manualLogout) {
        setAuthChecked(true);
        return;
      }
      void fetchDefaultToken().then((defaultToken) => {
        if (defaultToken) {
          setToken(defaultToken);
          setTokenState(defaultToken);
        } else {
          setAuthChecked(true);
        }
      });
      return;
    }
    fetchMe()
      .then((info) => {
        setAccount(info);
        setAuthChecked(true);
      })
      .catch(() => {
        setAuthChecked(true);
      });
  }, [token]);

  if (!authChecked) {
    return (
      <div class="container">
        <header class="brand">
          <h1 class="brand-title">Summarize_p2</h1>
        </header>
      </div>
    );
  }

  if (!token) {
    return (
      <div class="container">
        <header class="brand">
          <h1 class="brand-title">Summarize_p2</h1>
          <p class="brand-tagline">Distill any URL, file, or text into its essence.</p>
        </header>
        <TokenInput
          onAuthenticated={() => {
            setManualLogout(false);
            window.location.reload();
          }}
        />
      </div>
    );
  }

  return (
    <div class="container">
      <a href="#main" class="skip-link">
        Skip to content
      </a>

      <header class="brand">
        <div class="brand-header">
          <div>
            <h1 class="brand-title">
              <Link href="/" style={{ color: "inherit", textDecoration: "none" }}>
                Summarize_p2
              </Link>
            </h1>
            <p class="brand-tagline">Distill any URL, file, or text into its essence.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {account?.account?.name && (
              <span class="account-greeting">
                Hi, {account.account.name}
                {" \u00b7 "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    clearToken();
                    setManualLogout(true);
                    setTokenState("");
                    setAccount(null);
                    setAuthChecked(false);
                  }}
                  style={{
                    color: "var(--muted)",
                    fontSize: "12px",
                    textDecoration: "underline",
                    cursor: "pointer",
                  }}
                >
                  switch
                </a>
              </span>
            )}
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              title="Settings"
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                fontWeight: "500",
                fontFamily: "var(--font-body)",
                color: "var(--muted)",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "color 150ms ease, border-color 150ms ease",
              }}
            >
              {"\u2699\uFE0E"}
            </button>
          </div>
        </div>
      </header>

      <nav style={{ display: "flex", gap: "2px", marginBottom: "24px" }}>
        <NavTab href="/" active={route.view === "summarize"}>
          Summarize_p2
        </NavTab>
        <NavTab href="/history" active={route.view === "history"}>
          History
        </NavTab>
      </nav>

      <main id="main">
        {route.view === "summarize" && <SummarizeView />}
        {route.view === "history" && <HistoryView />}
        {route.view === "summary" && <ProcessView id={route.id} />}
      </main>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      <footer class="colophon">
        <a href="https://summarize.sh" target="_blank" rel="noopener noreferrer">
          Summarize_p2
        </a>
        {" \u2014 based on work by "}
        <a href="https://steipete.me" target="_blank" rel="noopener noreferrer">
          Peter Steinberger
        </a>
        <span class="version">v{__APP_VERSION__}</span>
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
    <Link
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
    </Link>
  );
}
