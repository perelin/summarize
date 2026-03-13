const STORAGE_KEY = "summarize-token";

export function getToken(): string {
  // Check URL param first (for initial setup)
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  if (urlToken) {
    setToken(urlToken);
    // Clean URL
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.toString());
    return urlToken;
  }
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function setToken(token: string) {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(STORAGE_KEY);
}
