import { useEffect, useState } from "preact/hooks";

export type Route =
  | { view: "summarize" }
  | { view: "history" }
  | { view: "summary"; id: string };

function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  if (h === "history") return { view: "history" };
  const summaryMatch = h.match(/^summary\/(.+)$/);
  if (summaryMatch) return { view: "summary", id: summaryMatch[1] };
  return { view: "summarize" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(window.location.hash),
  );

  useEffect(() => {
    const handler = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  return route;
}

export function navigate(path: string) {
  window.location.hash = path;
}
