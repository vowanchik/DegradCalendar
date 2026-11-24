FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global pnpm@11.25.0 && pnpm install --prod --frozen-lockfile --ignore-scripts
COPY server ./server
COPY scripts/backup.mjs ./scripts/backup.mjs
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/app/data DEMO_MODE=false
VOLUME ["/app/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
