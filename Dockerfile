# Glama MCP introspection (https://glama.ai/mcp/servers)
# Builds from source (dist/ is gitignored). Stdio only — no ports.
#
# Python + consensus-hardening-protocol so CHP bridge tools can warm on demand;
# initialize + tools/list work without a live engine.
#
# Paste this file into Glama's Dockerfile admin field if needed.

FROM node:23-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY engine ./engine
COPY README.md LICENSE AGENTS.md ./

RUN npm ci --no-audit --no-fund \
  && npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force

RUN pip3 install --break-system-packages --no-cache-dir -r engine/requirements.txt

ENV NODE_ENV=production
ENV CONDUCTOR_PYTHON=python3

# Official node image ships UID 1000 (`node`). Install/build stay root;
# the stdio server only needs to read /app and write /tmp.
USER node

CMD ["node", "dist/index.js"]
