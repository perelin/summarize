# Stage 1: Build
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY packages/core/package.json packages/core/tsconfig*.json ./packages/core/

# Remove prepare script to prevent build before source is copied
RUN sed -i 's/"prepare":.*,//' package.json

RUN CI=true pnpm install --frozen-lockfile

# Copy source code
COPY packages/core/src/ ./packages/core/src/
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN pnpm build

# Stage 2: Runtime
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist/ ./packages/core/dist/

# Remove prepare script for prod install
RUN sed -i 's/"prepare":.*,//' package.json

RUN CI=true pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist/ ./dist/

ENV SUMMARIZE_API_PORT=3000
EXPOSE 3000

CMD ["node", "dist/esm/server/main.js"]
