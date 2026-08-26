# syntax=docker/dockerfile:1
#
# ai-alm-oss container images.
#
# Targets:
#   runtime — lean governed-pipeline image: orchestrator + agent runner
#             (opencode CLI, uvx/MCP, git+ssh). No browser.
#   board   — runtime + Playwright/chromium for Jira board UI automation.
#
# Build gates: `tsc --noEmit` and the in-memory vitest suite must pass
# before an image layer is produced.

ARG NODE_VERSION=22
ARG OPENCODE_PIN=1.18.20
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.12.6

FROM ${UV_IMAGE} AS uv

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG OPENCODE_PIN
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client tini \
 && rm -rf /var/lib/apt/lists/*
# uv/uvx power the MCP servers declared in opencode.json (mcp-atlassian).
COPY --from=uv /uv /usr/local/bin/uv
COPY --from=uv /uvx /usr/local/bin/uvx
# Agent CLI pinned to the exact version used by the host and by
# .opencode/package.json (@opencode-ai/plugin) — reproducible runs.
RUN npm install -g --no-fund --no-audit opencode-ai@$OPENCODE_PIN \
 && npm cache clean --force
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY .opencode/package.json .opencode/package-lock.json ./.opencode/
WORKDIR /app/.opencode
RUN npm ci --no-fund --no-audit
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
# Gate 1: typecheck.
RUN npx tsc --noEmit
# Gate 2: unit + in-memory integration suite.
RUN npx vitest run --passWithNoTests

FROM base AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /app /app
# Writable cwd for the orchestrator lock file and wave workdirs.
RUN mkdir -p /app/state /app/.work \
 && chown node:node /app /app/state /app/.work
USER node
ENV HOME=/home/node \
    NODE_OPTIONS=--max-old-space-size=512 --expose-gc \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "tsx", "scripts/orchestrate.mts"]

FROM runtime AS board
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium \
 && rm -rf /root/.npm /var/lib/apt/lists*
USER node
