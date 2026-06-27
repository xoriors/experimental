# better-sqlite3 needs a native build toolchain at install time.
FROM node:20-bookworm-slim

WORKDIR /app

# Build tools for native modules (better-sqlite3). Kept in the image so the
# module can rebuild if needed; slim enough for a tiny always-on service.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev=false

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# auth/ and data/ are mounted as volumes so login + history survive restarts.
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
