FROM node:24-alpine

WORKDIR /app

# package.json and the lockfile are copied first, on their own. Docker caches
# each layer, so npm ci only re-runs when the dependencies actually change —
# editing index.js does not force a fresh install.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

# No --env-file here on purpose. Inside compose the environment is supplied by
# the compose file, and .env is excluded from the build context anyway, so
# reading one would only risk overriding the values compose just set.
CMD ["node", "index.js"]
