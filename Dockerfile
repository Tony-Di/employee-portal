FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY views ./views
COPY public ./public
COPY migrations ./migrations
COPY scripts ./scripts

RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node

ENV HOST=0.0.0.0 PORT=3100 DATA_DIR=/app/data
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/healthz >/dev/null || exit 1

CMD ["node", "src/server.js"]
