import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

export type Route =
  | { view: "summarize" }
  | { view: "history" }
  | { view: "summary"; id: string };

/** Custom event name dispatched by navigate() to trigger re-renders. */
const NAV_EVENT = "app:navigate";

function parsePath(pathname: string): Route {
  if (pathname === "/history") return { view: "history" };
  const summaryMatch = pathname.match(/^\/s\/([^/]+)$/);
  if (summaryMatch) return { view: "summary", id: summaryMatch[1] };
  return { view: "summarize" };
}

/**
 * One-time hash-to-path migration.
 * Converts legacy hash routes to path equivalents via replaceState.
 */
function migrateHashRoute(): void {
  const hash = window.location.hash;
  if (!hash) return;

  const h = hash.replace(/^#\/?/, "");
  if (h === "history") {
    history.replaceState(null, "", "/history");
  } else {
    const match = h.match(/^summary\/(.+)$/);
    if (match) {
      history.replaceState(null, "", `/s/${match[1]}`);
    } else if (h === "" || h === "/") {
      history.replaceState(null, "", "/");
    }
  }
}

// Run hash migration once on load
migrateHashRoute();

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parsePath(window.location.pathname),
  );

  useEffect(() => {
    const handler = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener("popstate", handler);
    window.addEventListener(NAV_EVENT, handler);
    return () => {
      window.removeEventListener("popstate", handler);
      window.removeEventListener(NAV_EVENT, handler);
    };
  }, []);

  return route;
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAV_EVENT));
}

/**
 * Internal link component that uses pushState navigation.
 * Prevents full-page reloads for same-origin paths.
 */
export function Link({
  href,
  children,
  ...props
}: {
  href: string;
  children: ComponentChildren;
  [key: string]: any;
}) {
  const handleClick = (e: MouseEvent) => {
    // Allow modified clicks (new tab, etc.) to pass through
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
