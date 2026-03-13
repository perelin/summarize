import { useState } from "preact/hooks";
import { getTheme, setTheme, type Theme } from "../lib/theme.js";

const LABELS: Record<Theme, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
};

const CYCLE: Theme[] = ["auto", "light", "dark"];

export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(getTheme);

  const toggle = () => {
    const idx = CYCLE.indexOf(theme);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    setTheme(next);
    setThemeState(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={`Theme: ${LABELS[theme]}`}
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
        whiteSpace: "nowrap",
      }}
    >
      {theme === "auto" ? "\u25D0" : theme === "light" ? "\u2600" : "\u263E"}{" "}
      {LABELS[theme]}
    </button>
  );
}
