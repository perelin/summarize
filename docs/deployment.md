# Deployment — summarize.p2lab.com

Production deployment of the Summarize API server on the Proxmox Docker host.

## Architecture

```
User → summarize.p2lab.com (DNS)
     → 138.201.193.245:443 (Caddy on CT 100, TLS termination)
     → 10.10.10.10:3100 (CT 101, Docker host)
     → container port 3000 (summarize-api)
     → LiteLLM at 10.10.10.10:4000 (internal, no TLS)
```

## Infrastructure locations

| Component | Location |
|-----------|----------|
| Docker image | `ghcr.io/perelin/summarize-api:latest` |
| App directory | CT 101: `/opt/apps/summarize/` |
| docker-compose.yml | CT 101: `/opt/apps/summarize/docker-compose.yml` |
| .env (secrets) | CT 101: `/opt/apps/summarize/.env` |
| yt-dlp config | CT 101: `/opt/apps/summarize/yt-dlp-config/config` |
| SQLite cache | CT 101: `/opt/apps/summarize/data/` (bind-mounted to `/root/.summarize`) |
| Caddy config | CT 100: `/etc/caddy/Caddyfile` (summarize.p2lab.com block) |
| DNS | Route53: `summarize.p2lab.com` A → `138.201.193.245` (zone `Z08892691H5OUUP9NJ5OT`) |
| Dockhand | Registered as `summarize` stack |

## SSH aliases

- `pve-htz` — Proxmox host (for `pct exec` into CTs)
- `pve-htz-docker` — CT 101 (Docker host) directly

## How to deploy

### Standard: Create a GitHub Release

The recommended way to deploy. The `deploy.yml` GitHub Action triggers on release:

1. Create a release on GitHub (or via CLI):
   ```bash
   gh release create v0.12.1 --title "v0.12.1" --notes "Description of changes"
   ```
2. The action builds the Docker image, pushes to ghcr.io (`:latest` + `:v0.12.1`), pulls on the server, restarts, and verifies health.
3. Monitor: `gh run watch` or check the Actions tab.

The action can also be triggered manually via `workflow_dispatch` from the Actions tab.

### Manual: Local build (fallback / hotfix)

```bash
# 1. Build and push (from local repo)
docker buildx build --platform linux/amd64 \
  -t ghcr.io/perelin/summarize-api:latest \
  -t ghcr.io/perelin/summarize-api:$(node -p "require('./package.json').version") \
  --push .

# 2. Pull and restart on server
ssh pve-htz-docker 'cd /opt/apps/summarize && docker compose pull -q && docker compose up -d'
```

### Environment variable sync

To sync local `.env` changes to production (preserves remote-only vars like internal base URLs and yt-dlp settings):

```bash
./scripts/deploy-env.sh            # interactive — shows diff and asks for confirmation
./scripts/deploy-env.sh --dry-run  # preview only, no changes
```

After syncing env vars, restart the container:
```bash
ssh pve-htz-docker 'cd /opt/apps/summarize && docker compose restart'
```

### GHCR authentication

The `gh` CLI token needs `write:packages` scope:

```bash
gh auth refresh -h github.com -s write:packages  # one-time
gh auth token | docker login ghcr.io -u perelin --password-stdin
```

On the server (one-time):

```bash
gh auth token | ssh pve-htz-docker 'docker login ghcr.io -u perelin --password-stdin'
```

## docker-compose.yml

```yaml
services:
  summarize-api:
    image: ghcr.io/perelin/summarize-api:latest
    container_name: summarize-api
    restart: unless-stopped
    ports:
      - "3100:3000"
    env_file:
      - .env
    volumes:
      - ./data:/root/.summarize
      - ./yt-dlp-config:/root/.config/yt-dlp:ro
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:3000/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    deploy:
      resources:
        limits:
          memory: 2G
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
```

## Environment variables (.env)

Key groups (see `.env.example` for full list):

| Variable | Purpose |
|----------|---------|
| `SUMMARIZE_API_TOKEN` | Bearer token for API auth |
| `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` / `GEMINI_BASE_URL` | LiteLLM proxy (`http://10.10.10.10:4000/v1`) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | LiteLLM master key |
| `MISTRAL_API_KEY` | Transcription (direct, not proxied) |
| `YT_DLP_PATH` | `/usr/local/bin/yt-dlp` |

## yt-dlp proxy (Oxylabs)

YouTube bot detection blocks server IPs. yt-dlp is configured with an Oxylabs residential proxy via the bind-mounted config file at `/opt/apps/summarize/yt-dlp-config/config`:

```
--js-runtimes node
--remote-components ejs:github
--proxy http://customer-<USERNAME>-cc-US:<PASSWORD>@pr.oxylabs.io:7777
```

The `bgutil-ytdlp-pot-provider` pip package is installed in the container for YouTube PO token generation, though the proxy alone typically bypasses bot detection.

To update proxy credentials, edit the config on the server:

```bash
ssh pve-htz-docker 'nano /opt/apps/summarize/yt-dlp-config/config'
ssh pve-htz-docker 'cd /opt/apps/summarize && docker compose restart'
```

## Caddy reverse proxy (CT 100)

Block in `/etc/caddy/Caddyfile`:

```
summarize.p2lab.com {
    reverse_proxy 10.10.10.10:3100 {
        transport http {
            read_timeout 300s
            write_timeout 300s
        }
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
    request_body {
        max_size 12MB
    }
}
```

Extended timeouts (300s) because video transcription can take minutes.

To modify: `ssh pve-htz 'pct exec 100 -- nano /etc/caddy/Caddyfile'`
Validate: `ssh pve-htz 'pct exec 100 -- caddy validate --config /etc/caddy/Caddyfile'`
Reload: `ssh pve-htz 'pct exec 100 -- systemctl reload caddy'`

## Verification

```bash
# Health (internal)
ssh pve-htz-docker 'curl -s http://localhost:3100/v1/health'

# Health (external)
curl https://summarize.p2lab.com/v1/health

# Container status
ssh pve-htz-docker 'docker inspect summarize-api --format={{.State.Health.Status}}'

# Logs
ssh pve-htz-docker 'docker logs summarize-api --tail 50'

# Test summarization
curl -X POST https://summarize.p2lab.com/v1/summarize \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "length": "short"}'
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| DNS not resolving | `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder` |
| TLS cert error | Caddy auto-provisions certs; reload: `ssh pve-htz 'pct exec 100 -- systemctl reload caddy'` |
| yt-dlp bot detection | Check proxy credentials in yt-dlp-config/config; test: `docker exec summarize-api yt-dlp --print title "https://youtu.be/dQw4w9WgXcQ"` |
| YouTube returns generic page | Clear cache: `docker exec summarize-api rm -f /root/.summarize/cache.sqlite*` |
| Build fails on patches | Ensure `COPY patches/ ./patches/` is in both Dockerfile stages |
| GHCR push denied | `gh auth refresh -h github.com -s write:packages` |
