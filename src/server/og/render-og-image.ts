import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

// ── Font Loading ──────────────────────────────────────────────
// Satori needs raw font buffers. We fetch from Google Fonts once at startup
// and cache in memory. The User-Agent trick gets .ttf instead of woff2.

const GOOGLE_FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1&family=Space+Grotesk:wght@500;600&display=swap";

let fontsPromise: Promise<
  Array<{ name: string; data: ArrayBuffer; weight: number; style: string }>
> | null = null;

async function loadFonts() {
  // Fetch CSS with old user-agent to get woff (not woff2) which Satori supports
  const css = await fetch(GOOGLE_FONTS_CSS, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 6.1; rv:10.0) Gecko/20100101 Firefox/10.0",
    },
  }).then((r) => r.text());

  // Parse font URLs from CSS @font-face blocks
  const fonts: Array<{ name: string; data: ArrayBuffer; weight: number; style: string }> = [];

  // Match each @font-face block
  const blocks = css.match(/@font-face\s*\{[^}]+\}/g) ?? [];
  for (const block of blocks) {
    const familyMatch = block.match(/font-family:\s*'([^']+)'/);
    const weightMatch = block.match(/font-weight:\s*(\d+)/);
    const styleMatch = block.match(/font-style:\s*(\w+)/);
    // Google Fonts returns URLs like url(https://fonts.gstatic.com/l/font?kit=...)
    // with format('woff') or format('truetype') — match any url() in src
    const urlMatch = block.match(/url\(([^)]+)\)/);
    if (!familyMatch || !urlMatch) continue;

    const data = await fetch(urlMatch[1]).then((r) => r.arrayBuffer());
    fonts.push({
      name: familyMatch[1],
      data,
      weight: weightMatch ? parseInt(weightMatch[1], 10) : 400,
      style: styleMatch?.[1] ?? "normal",
    });
  }

  if (fonts.length === 0) {
    throw new Error("Failed to load any fonts from Google Fonts");
  }

  return fonts;
}

function getFonts() {
  if (!fontsPromise) {
    fontsPromise = loadFonts().catch((err) => {
      fontsPromise = null; // retry on next call
      throw err;
    });
  }
  return fontsPromise;
}

// ── Source Type Labels ────────────────────────────────────────

const SOURCE_TYPE_LABELS: Record<string, string> = {
  video: "Video",
  podcast: "Podcast",
  article: "Article",
  text: "Text",
};

// ── Duration formatting ──────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}

function formatWordCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k words`;
  return `${count} words`;
}

// ── Extract domain from URL ──────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ── Truncate title ───────────────────────────────────────────

function truncateTitle(title: string, maxLen = 80): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

// ── OG Image Data ────────────────────────────────────────────

export type OgImageData = {
  title: string | null;
  summary: string;
  sourceUrl: string | null;
  sourceType: string;
  mediaDurationSeconds: number | null;
  wordCount: number | null;
};

function deriveTitle(data: { title: string | null; summary: string }): string {
  if (data.title) return data.title;
  const firstLine = data.summary.split("\n").find((l) => l.trim().length > 0) ?? "";
  const clean = firstLine
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
  return clean || "Shared Summary";
}

// ── Render ────────────────────────────────────────────────────

export async function renderOgImage(data: OgImageData): Promise<Uint8Array> {
  const fonts = await getFonts();

  const title = truncateTitle(deriveTitle(data));
  const domain = data.sourceUrl ? extractDomain(data.sourceUrl) : null;
  const sourceLabel = SOURCE_TYPE_LABELS[data.sourceType] ?? "Summary";
  const duration = data.mediaDurationSeconds ? formatDuration(data.mediaDurationSeconds) : null;
  const words = data.wordCount ? formatWordCount(data.wordCount) : null;

  // Build meta items
  const metaItems: string[] = [];
  if (domain) metaItems.push(domain);
  if (duration) metaItems.push(duration);
  if (words) metaItems.push(words);

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "48px",
          backgroundColor: "#f0ebe3",
          fontFamily: "Space Grotesk",
          position: "relative",
        },
        children: [
          // Red accent bar at top
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "5px",
                backgroundColor: "#c93a1e",
              },
            },
          },
          // Logo row
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "12px",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      width: "36px",
                      height: "36px",
                      backgroundColor: "#c93a1e",
                      borderRadius: "8px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fdfbf7",
                      fontWeight: 700,
                      fontSize: "18px",
                    },
                    children: "S",
                  },
                },
                {
                  type: "span",
                  props: {
                    style: {
                      fontSize: "15px",
                      color: "#6b6155",
                      fontWeight: 500,
                      letterSpacing: "2px",
                      textTransform: "uppercase" as const,
                    },
                    children: "Summarize",
                  },
                },
              ],
            },
          },
          // Title area
          {
            type: "div",
            props: {
              style: {
                flex: 1,
                display: "flex",
                alignItems: "center",
                paddingTop: "8px",
                paddingBottom: "8px",
              },
              children: {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Instrument Serif",
                    fontSize: "42px",
                    lineHeight: 1.25,
                    color: "#1a1613",
                    fontWeight: 400,
                    fontStyle: "italic",
                    maxWidth: "85%",
                  },
                  children: title,
                },
              },
            },
          },
          // Meta row
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "15px",
                color: "#6b6155",
                fontWeight: 500,
              },
              children: metaItems.flatMap((item, i) => {
                const els: Array<{ type: string; props: Record<string, unknown> }> = [];
                if (i > 0) {
                  els.push({
                    type: "span",
                    props: { style: { color: "#c93a1e", margin: "0 6px" }, children: "·" },
                  });
                }
                els.push({ type: "span", props: { children: item } });
                return els;
              }),
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: fonts.map((f) => ({
        name: f.name,
        data: f.data,
        weight: f.weight as 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900,
        style: f.style as "normal" | "italic",
      })),
    },
  );

  // Convert SVG to PNG
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}
