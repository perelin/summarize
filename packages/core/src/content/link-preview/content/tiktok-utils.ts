const TIKTOK_HOSTS = new Set(["tiktok.com", "vm.tiktok.com"]);

const TIKTOK_VIDEO_PATH_PATTERN = /^\/@[^/]+\/video\/\d+/;
const TIKTOK_SHORT_PATH_PATTERN = /^\/t\/[^/]+/;

export function isTikTokVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!TIKTOK_HOSTS.has(host)) return false;
    if (host === "vm.tiktok.com") return parsed.pathname.length > 1;
    return (
      TIKTOK_VIDEO_PATH_PATTERN.test(parsed.pathname) ||
      TIKTOK_SHORT_PATH_PATTERN.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}
