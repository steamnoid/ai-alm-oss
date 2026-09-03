# syntax=docker/dockerfile:1
#
# ai-alm-oss runtime — dispatcher worker image.
# Banalny dispatcher: skill robi całą Jirę w kontenerze (opencode run <skill> <key>).
# Host `dispatcher` odpala `docker run -d` per pickup ticket.
#
# Targets:
#   runtime — lean governed-pipeline image (opencode CLI, uvx/MCP, git).

ARG NODE_VERSION=22
ARG OPENCODE_PIN=1.18.20
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.12.6

FROM ${UV_IMAGE} AS uv

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG OPENCODE_PIN
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client tini procps \
 && rm -rf /var/lib/apt/lists/*
COPY --from=uv /uv /usr/local/bin/uv
COPY --from=uv /uvx /usr/local/bin/uvx
RUN npm install -g --no-fund --no-audit opencode-ai@$OPENCODE_PIN \
 && npm cache clean --force
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
# opencode skills need tsx at runtime (tsx scripts/*.mts)
COPY .opencode/package.json .opencode/package-lock.json ./.opencode/
WORKDIR /app/.opencode
RUN npm ci --no-fund --no-audit || true
WORKDIR /app

FROM deps AS build
WORKDIR /app
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
COPY .opencode/skills ./.opencode/skills
COPY .opencode/commands ./.opencode/commands
COPY opencode.json ./
RUN npx tsc --noEmit
RUN npx vitest run --passWithNoTests

FROM base AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.work && chown node:node /app /app/.work
USER node
ENV HOME=/home/node
ENV NODE_OPTIONS="--max-old-space-size=512 --expose-gc"
# Dispatcher sets the per-container health endpoint via `docker run --health-cmd`;
# image-level HEALTHCHECK is a fallback (opencode process liveness).
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s CMD cat /proc/*/cmdline 2>/dev/null | tr "\0" " " | grep -q "opencode" || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "opencode", "run", "--help"]
