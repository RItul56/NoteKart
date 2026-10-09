FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY server ./server
COPY public ./public
COPY database ./database
COPY scripts/apply-schema.js ./scripts/apply-schema.js
COPY scripts/promote-admin.js ./scripts/promote-admin.js

RUN mkdir -p /app/storage/uploads && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server/server.js"]
