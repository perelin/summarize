import { Hono } from "hono";
import type { HistoryStore } from "../../history.js";
import type { ApiLength } from "../types.js";
import { mapApiLength } from "../utils/length-map.js";

export type ResummarizeRouteDeps = {
  historyStore: HistoryStore;
  /** The main Hono app — used to internally dispatch a /v1/summarize request. */
  app: Hono;
};

type Variables = { account: string };

/** Extract the first Markdown heading from a summary to use as a display title. */
function extractFirstHeading(markdown: string): string | null {
  const match = markdown.match(/^#{1,6}\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

export function createResummarizeRoute(deps: ResummarizeRouteDeps): Hono<{ Variables: Variables }> {
  const route = new Hono<{ Variables: Variables }>();

  route.post("/history/:id/resummarize", async (c) => {
    const account = c.get("account") as string;
    const entryId = c.req.param("id");

    // Load existing entry
    const entry = deps.historyStore.getById(entryId, account);
    if (!entry) {
      return c.json({ error: { code: "NOT_FOUND", message: "History entry not found" } }, 404);
    }

    if (!entry.transcript || entry.transcript.length === 0) {
      return c.json(
        {
          error: {
            code: "NO_TRANSCRIPT",
            message: "No source text available for re-summarization",
          },
        },
        422,
      );
    }

    // Parse and validate length
    const body = await c.req
      .json<{ length?: ApiLength; model?: string }>()
      .catch((): { length?: ApiLength; model?: string } => ({}));
    if (!body.length) {
      return c.json(
        { error: { code: "MISSING_LENGTH", message: "length parameter is required" } },
        400,
      );
    }

    let lengthRaw: string;
    try {
      lengthRaw = mapApiLength(body.length);
    } catch {
      return c.json(
        { error: { code: "INVALID_LENGTH", message: `Invalid length: ${body.length}` } },
        400,
      );
    }

    const startTime = Date.now();
    console.log(`[summarize-api] resummarize: id=${entryId} length=${body.length} (${lengthRaw})`);

    // Dispatch an internal request to /v1/summarize with the stored transcript.
    // This reuses the fully working text-mode summarization pipeline.
    const authHeader = c.req.header("authorization") ?? "";
    const internalReq = new Request("http://internal/v1/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        text: entry.transcript,
        length: body.length,
        ...(body.model ? { model: body.model } : {}),
      }),
    });

    const internalRes = await deps.app.fetch(internalReq);

    if (!internalRes.ok || !internalRes.body) {
      const errBody = await internalRes.text().catch(() => "");
      console.error(
        "[summarize-api] resummarize internal request failed:",
        internalRes.status,
        errBody,
      );
      return c.json(
        { error: { code: "SUMMARIZE_FAILED", message: "Re-summarization failed" } },
        502,
      );
    }

    // Stream the SSE response through, intercepting chunks to collect the summary
    // and the done event to update history.
    const chunks: string[] = [];
    let usedModel: string | null = null;

    const reader = internalRes.body.getReader();
    const decoder = new TextDecoder();

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Process in background: read from internal response, intercept events, forward to client
    const processing = (async () => {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          buffer += text;

          // Parse SSE events to intercept chunk/meta/done
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (currentEvent === "chunk" && data.text) {
                  chunks.push(data.text);
                }
                if (currentEvent === "meta" && data.model) {
                  usedModel = data.model;
                }
              } catch {
                /* ignore parse errors */
              }
              currentEvent = "";
            }
          }

          // Forward raw bytes to client
          await writer.write(value);
        }
      } finally {
        await writer.close();
      }

      // After streaming completes, update the history entry
      const summaryText = chunks.join("");
      if (summaryText.length > 0) {
        try {
          deps.historyStore.updateSummary(entryId, account, {
            summary: summaryText,
            inputLength: lengthRaw,
            model: usedModel ?? entry.model,
            title: extractFirstHeading(summaryText) ?? entry.title,
            metadata: entry.metadata,
          });
        } catch (histErr) {
          console.error("[summarize-api] resummarize history update failed:", histErr);
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(
        `[summarize-api] resummarize complete: id=${entryId} length=${body.length} ${elapsed}ms`,
      );
    })();

    // Don't await processing — it runs as the stream is consumed
    processing.catch((err) => console.error("[summarize-api] resummarize stream error:", err));

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return route;
}
