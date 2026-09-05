# syntax=docker/dockerfile:1
#
# Multi-stage build for the Nuxt app.
#
# Stage 1 installs dev dependencies and compiles; stage 2 keeps only the
# compiled output. The result is a few hundred MB instead of the ~1.5 GB a
# single-stage build would produce, because node_modules never ships.
#
# Build from the REPOSITORY ROOT, not from this directory:
#   docker build -f server-drift/Dockerfile -t ai-demo .

# ---- stage 1: build ---------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /build

# Copy manifests first. Docker caches each layer, so dependencies are only
# reinstalled when these two files change — not on every source edit.
COPY package.json package-lock.json ./

# --legacy-peer-deps works around an npm 10.8 arborist bug on this dependency
# tree; see the README. `npm ci` installs exactly what the lockfile pins.
RUN npm ci --legacy-peer-deps --no-audit --no-fund

COPY . .
RUN npm run build

# ---- stage 2: runtime -------------------------------------------------------
FROM node:20-alpine AS runtime

# Never run application code as root in a container.
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# The compiled server, self-contained.
COPY --from=builder --chown=app:app /build/.output ./.output

# The RAG index is built at boot by reading knowledge/ relative to the working
# directory, so these files must exist in the runtime image. Forgetting this
# produces a container that starts cleanly and then 500s on the first search.
COPY --from=builder --chown=app:app /build/knowledge ./knowledge

USER app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

EXPOSE 3000

# Compose and orchestrators read this to decide whether the container is live.
# /api/health reports which AI provider is wired up without exposing the key.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
