# ---------------------------------------------------------------------------
# Stage 1 — install dependencies.
# Everything npm does while resolving and downloading packages (its cache, any
# build tooling) stays in this stage and never reaches the final image.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps

WORKDIR /app

# The lockfile is copied on its own first so Docker can cache this layer:
# npm ci only re-runs when dependencies change, not when index.js is edited.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Stage 2 — the image that actually ships.
# Starts from a clean base and copies in only the installed modules and the
# source files the app needs at runtime.
# ---------------------------------------------------------------------------
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY index.js db.js openapi.json ./

# The node image ships a non-root `node` user. Running as root inside a
# container is a needless risk: a process that escapes its boundary should not
# arrive as root on the host.
USER node

EXPOSE 3000

# No --env-file here on purpose. Inside compose the environment is supplied by
# the compose file, and .env is excluded from the build context anyway, so
# reading one would only risk overriding the values compose just set.
CMD ["node", "index.js"]
