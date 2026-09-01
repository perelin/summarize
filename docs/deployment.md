# Deployment — summarize.p2lab.com

Production deployment of the Summarize API server on **Coolify** (Proxmox CT 103), since 2026-08-08. The previous compose-based deployment on CT 101 is documented at the end as fallback.

## Architecture

```
User → summarize.p2lab.com (DNS)
     → 138.201.193.245:443 (Caddy on CT 100, TLS termination, 300s timeouts)
     → 10.10.10.12:80 (CT 103, Coolify Traefik — routes by Host header, plain HTTP)
     → container port 3000 (Coolify app "summarize-test")
     → OpenRouter (https://openrouter.ai/api/v1) for summarization LLM calls
```

## Infrastructure locations

| Component      | Location                                                                            |
| -------------- | ----------------------------------------------------------------------------------- |
| Coolify app    | CT 103, project "summarize", app `summarize-test` (uuid `m7k86vl5w0f2gcsq6ppdl05p`) |
| Source         | `perelin/summarize` via GitHub App `coolify-p2lab`, branch `main`, Dockerfile build |
| Domains        | `http://summarize.p2lab.com,http://summarize-test.p2lab.com` (http — TLS is at CT 100) |
| Data (`/data`) | Named Docker volume `summarize-test-data` on CT 103 (config.json + sqlite)          |
| yt-dlp config  | CT 103: `/data/coolify/applications/m7k86vl5w0f2gcsq6ppdl05p/yt-dlp-config` → file mount `/root/.config/yt-dlp/config` |
| Env vars       | In Coolify (UI/API), all with build-time **off** — see gotchas below                |
| Caddy config   | CT 100: `/etc/caddy/Caddyfile` (`summarize.p2lab.com` → `10.10.10.12:80`)           |
| DNS            | Route53: `summarize.p2lab.com` A → `138.201.193.245`                                |

SSH aliases: `pve-htz` (Proxmox host), `pve-htz-coolify` (CT 103), `pve-htz-docker` (CT 101, old deployment).

## How to deploy

**Push to `main`.** The GitHub App webhook triggers a Coolify build + rolling deploy automatically. No image registry, no GitHub Action, no version bump required.

Manual deploy / API access (Coolify API is only reachable via tunnel — Caddy basic-auth eats the Bearer header on the public URL):

```bash
ssh -f -N -L 18000:localhost:8000 pve-htz-coolify
TOKEN=$(pass show services/coolify/api-token | head -1)

# Trigger deploy
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:18000/api/v1/deploy?uuid=m7k86vl5w0f2gcsq6ppdl05p"

# App status
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:18000/api/v1/applications/m7k86vl5w0f2gcsq6ppdl05p | jq -r .status
```

Deploy notifications (success + failure) arrive on the shared ntfy alert topic.

### Rollback

Coolify UI → app → Deployments → redeploy an earlier build, or `git revert` + push. For a total Coolify outage, fall back to the old CT 101 deployment (below).

## Configuration

### Env vars

Managed in Coolify (app → Environment Variables). Current set: `SUMMARIZE_API_PORT`, `OPENROUTER_API_KEY`, `SUMMARIZE_MODEL`, `MISTRAL_API_KEY`, `YT_DLP_PATH`, `YT_DLP_PROXY`, `NODE_OPTIONS`. (`OPENROUTER_BASE_URL` is optional — the code defaults to `https://openrouter.ai/api/v1`.)

Since 2026-09-01 the app talks to OpenRouter **natively**: `OPENROUTER_API_KEY` = dedicated OpenRouter key (`pass services/summarize/openrouter-key`), `SUMMARIZE_MODEL=deepseek/deepseek-v4-flash-0731`. (From 2026-08-08 to 2026-09-01 the LiteLLM-named env vars pointed at OpenRouter; the LiteLLM-gateway code and its env names were removed in the 2026-09-01 migration.) Transcription (`MISTRAL_API_KEY`) goes direct to Mistral, unchanged. Note: DeepSeek V4 Flash is a reasoning model — it emits reasoning tokens before visible text, so very small `max_tokens` budgets can be consumed by reasoning.

**Gotcha:** every env var has *Build Variable* (DB: `is_buildtime`) switched **off**. Coolify's default (on) injects all envs as Dockerfile `ARG`s; `NODE_OPTIONS=--use-openssl-ca` then breaks `corepack prepare` TLS in the `node:22-slim` builder stage (no ca-certificates installed there). Keep it off for any new vars.

### Account authentication

`accounts` array in `config.json` inside the `summarize-test-data` volume:

```bash
ssh pve-htz-coolify 'sudo nano /var/lib/docker/volumes/summarize-test-data/_data/config.json'
# then restart the app (UI or API)
```

### yt-dlp proxy (Oxylabs)

Config is a Coolify file mount, on CT 103 host at
`/data/coolify/applications/m7k86vl5w0f2gcsq6ppdl05p/yt-dlp-config`:

```
--js-runtimes node
--remote-components ejs:github
--proxy http://customer-<USERNAME>-cc-US:<PASSWORD>@pr.oxylabs.io:7777
```

Edit on the host, then restart the app. The entrypoint self-updates yt-dlp on every container start.

## Verification

```bash
curl https://summarize.p2lab.com/v1/health   # {"status":"ok"}

# Logs / container
ssh pve-htz-coolify 'sudo docker logs --tail 50 $(sudo docker ps -q --filter name=m7k86vl5w0f2)'

# Test summarization (OpenRouter LLM path)
curl -X POST https://summarize.p2lab.com/v1/summarize \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "length": "short"}'

# Test YouTube path (yt-dlp + proxy)
curl -X POST https://summarize.p2lab.com/v1/summarize \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "length": "short"}'
```

## Troubleshooting

| Issue | Fix |
| ----- | --- |
| Build fails fetching npm registry (`corepack` Internal Error) | Two known causes, both fixed instance-wide 2026-08-08: (1) a *Build Variable* env leaking `NODE_OPTIONS` into the builder — keep `is_buildtime` off; (2) IPv6-first DNS on CT 103 with no v6 route — `precedence ::ffff:0:0/96 100` in CT 103 `/etc/gai.conf` |
| Container start fails: "not a directory" on yt-dlp config mount | The file mount source on CT 103 host must exist as a **file** before deploy; if Docker created a directory there, remove it and recreate the file |
| yt-dlp bot detection | Check proxy credentials in the file mount; test: `docker exec <container> yt-dlp --print title "https://youtu.be/dQw4w9WgXcQ"` |
| YouTube returns generic page | Clear cache in the volume: `docker exec <container> rm -f /data/cache.sqlite*` |
| TLS cert error | Caddy auto-provisions; reload: `ssh pve-htz 'pct exec 100 -- systemctl reload caddy'` |
| 502 from Caddy | App container starting/crashed — check logs; Traefik on CT 103 routes by Host header, so the Coolify FQDN must match the domain and be `http://` |

## Legacy: CT 101 compose deployment (fallback)

Until 2026-08-08 the app ran on CT 101 (`pve-htz-docker`) at `/opt/apps/summarize/` (compose file, `.env`, `data/`, `yt-dlp-config/`), image `ghcr.io/perelin/summarize-api:latest`. The container is **stopped but intact** — data was migrated to Coolify at cutover, so its `data/` is a snapshot from 2026-08-08.

The image pipeline for the fallback was removed on 2026-09-01 together with the OpenRouter migration (`deploy.yml` GitHub Action deleted — releases no longer build images; `scripts/deploy-env.sh` / `deploy-config.sh` deleted — env lives in Coolify, `config.json` in the Coolify volume). The last published `ghcr.io/perelin/summarize-api:latest` image remains pullable if you ever need the fallback.

To fall back: `ssh pve-htz-docker 'cd /opt/apps/summarize && docker compose up -d'` and repoint the Caddy block on CT 100 back to `10.10.10.10:3100`. Note: that image predates the OpenRouter migration — set `LITELLM_BASE_URL=https://openrouter.ai/api/v1` + `LITELLM_API_KEY=<openrouter key>` in its `.env` (the old code reads the LiteLLM-named vars), and expect the pre-migration model default. History/config changes made since the cutover live in the Coolify volume and would need copying back.
