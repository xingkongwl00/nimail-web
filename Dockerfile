FROM node:22-alpine

LABEL org.opencontainers.image.title="nimail-web" \
      org.opencontainers.image.description="临时邮箱网站（NiMail API 零依赖 Node.js 代理）" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public/ ./public/

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
