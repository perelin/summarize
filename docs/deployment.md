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

| Component          | Location                                                                            |
| ------------------ | ----------------------------------------------------------------------------------- |
| Docker image       | `ghcr.io/perelin/summarize-api:latest`                                              |
| App directory      | CT 101: `/opt/apps/summarize/`                                                      |
| docker-compose.yml | CT 101: `/opt/apps/summarize/docker-compose.yml`                                    |
| .env (secrets)     | CT 101: `/opt/apps/summarize/.env`                                                  |
| yt-dlp config      | CT 101: `/opt/apps/summarize/yt-dlp-config/config`                                  |
| SQLite cache       | CT 101: `/opt/apps/summarize/data/` (bind-mounted to `/data` via `SUMMARIZE_DATA_DIR`) |
| Caddy config       | CT 100: `/etc/caddy/Caddyfile` (summarize.p2lab.com block)                          |
| DNS                | Route53: `summarize.p2lab.com` A → `138.201.193.245` (zone `Z08892691H5OUUP9NJ5OT`) |
| Dockhand           | Registered as `summarize` stack                                                     |

## SSH aliases

- `pve-htz` — Proxmox host (for `pct exec` into CTs)
- `pve-htz-docker` — CT 101 (Docker host) directly

## How to deploy

### Standard: Taskfile (`task deploy`)

The recommended way to deploy. Requires [go-task](https://taskfile.dev):

```bash
task deploy              # bump patch, check, build, release (triggers deploy Action)
task deploy BUMP=minor   # bump minor version
task deploy:quick        # skip checks/build, just bump + release
task deploy:manual       # trigger deploy Action without version bump
task status              # show recent deploys + server health
```

Under the hood, `task deploy` bumps the version in `package.json`, commits, pushes, and creates a GitHub Release. The `deploy.yml` GitHub Action triggers on release:

1. Builds the Docker image natively on linux/amd64 (no cross-compilation), pushes to ghcr.io with `:latest` and version tags
2. SSHs to the server to pull and restart
3. Verifies the health check

The action can also be triggered manually via `workflow_dispatch` from the Actions tab (deploys `main` with `:latest` tag only).

### CI/CD pipeline details

```
GitHub Release → deploy.yml Action
  ├─ Build Docker image (ubuntu-latest, native amd64, ~2min with GHA cache)
  ├─ Push to ghcr.io/perelin/summarize-api (:latest + :version)
  ├─ SSH to pve-htz-docker (via ProxyJump through pve-htz)
  ├─ docker compose pull + up -d
  └─ Health check with retries (5 attempts, 5s interval)
```

GitHub secrets required:

| Secret           | Purpose                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `DEPLOY_SSH_KEY` | SSH private key (`~/.ssh/id_rsa`) for accessing pve-htz and pve-htz-docker |

The `GITHUB_TOKEN` (automatic) handles GHCR authentication. The ghcr.io package must be linked to the repo with write access (Settings → Manage Actions access).

### Rollback

Images are tagged by version, so rolling back is quick:

```bash
# On the server, pin to a previous version
ssh pve-htz-docker 'cd /opt/apps/summarize && \
  sed -i "s|image:.*|image: ghcr.io/perelin/summarize-api:0.12.0|" docker-compose.yml && \
  docker compose pull -q && docker compose up -d'
```

To restore `:latest` tracking after the fix:

```bash
ssh pve-htz-docker 'cd /opt/apps/summarize && \
  sed -i "s|image:.*|image: ghcr.io/perelin/summarize-api:latest|" docker-compose.yml && \
  docker compose pull -q && docker compose up -d'
```

### Environment variable sync

Local and remote `.env` files differ by design — remote uses internal IPs and has production-only vars (yt-dlp proxy). Use the sync script to push new/changed vars while preserving remote-only settings:

```bash
./scripts/deploy-env.sh            # interactive — shows diff and asks for confirmation
./scripts/deploy-env.sh --dry-run  # preview only, no changes
```

The script preserves these remote-only vars (never overwritten from local):

- `*_BASE_URL` — remote uses internal `http://10.10.10.10:4000/v1`
- `YT_DLP_*` — production-only proxy and path settings

After syncing env vars, restart the container:

```bash
ssh pve-htz-docker 'cd /opt/apps/summarize && docker compose restart'
```

### Config sync

The project-local `config.json` (gitignored) contains account tokens. Sync it to the server:

```bash
./scripts/deploy-config.sh            # interactive — shows diff and asks for confirmation
./scripts/deploy-config.sh --dry-run  # preview only, no changes
```

After syncing, restart the container:

```bash
ssh pve-htz-docker 'cd /opt/apps/summarize && docker compose restart'
```

### GHCR authentication

For local builds, the `gh` CLI token needs `write:packages` scope:

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
      - ./data:/data
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
    labels:
      portal.enable: "true"
      portal.name: "Summarize"
      portal.url: "https://summarize.p2lab.com"
      portal.description: "AI-powered content summarization"
      portal.icon: "📝"
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
```

## Environment variables (.env)

Key groups (see `.env.example` for full list):

| Variable                                                     | Purpose                                      |
| ------------------------------------------------------------ | -------------------------------------------- |
| `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` / `GEMINI_BASE_URL` | LiteLLM proxy (`http://10.10.10.10:4000/v1`) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`    | LiteLLM master key                           |
| `MISTRAL_API_KEY`                                            | Transcription (direct, not proxied)          |
| `YT_DLP_PATH`                                                | `/usr/local/bin/yt-dlp`                      |

### Account authentication

API auth is configured via `accounts` in `data/config.json` (bind-mounted to `/data/config.json` via `SUMMARIZE_DATA_DIR=/data`):

```json
{
  "accounts": [
    { "name": "alice", "token": "<32+ char token>" },
    { "name": "bob", "token": "<32+ char token>" }
  ]
}
```

The server requires at least one account. Each account gets isolated summarization history.

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

| Issue                             | Fix                                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy action: GHCR push 403      | Ensure the ghcr.io package is linked to the repo with write access: [package settings](https://github.com/users/perelin/packages/container/package/summarize-api/settings) → Manage Actions access → add `perelin/summarize` with Write role |
| Deploy action: SSH failure        | Verify `DEPLOY_SSH_KEY` secret is set: `gh secret list`. Re-set if needed: `gh secret set DEPLOY_SSH_KEY < ~/.ssh/id_rsa`                                                                                                                    |
| Deploy action: health check fails | Check container logs: `ssh pve-htz-docker 'docker logs summarize-api --tail 50'`                                                                                                                                                             |
| DNS not resolving                 | `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`                                                                                                                                                                              |
| TLS cert error                    | Caddy auto-provisions certs; reload: `ssh pve-htz 'pct exec 100 -- systemctl reload caddy'`                                                                                                                                                  |
| yt-dlp bot detection              | Check proxy credentials in yt-dlp-config/config; test: `docker exec summarize-api yt-dlp --print title "https://youtu.be/dQw4w9WgXcQ"`                                                                                                       |
| YouTube returns generic page      | Clear cache: `docker exec summarize-api rm -f /data/cache.sqlite*`                                                                                                                                                                |
| Build fails on patches            | Ensure `COPY patches/ ./patches/` is in both Dockerfile stages                                                                                                                                                                               |
| GHCR push denied (local)          | `gh auth refresh -h github.com -s write:packages`                                                                                                                                                                                            |
