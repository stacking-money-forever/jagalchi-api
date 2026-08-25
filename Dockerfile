FROM node:24-alpine AS builder
WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/api/package.json services/api/package.json
RUN pnpm install --filter @jagalchi/api... --frozen-lockfile

COPY services/api services/api
RUN pnpm --filter @jagalchi/api build
RUN pnpm --filter @jagalchi/api deploy --prod /app

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node dist/database/run-migrations.js && node dist/main.js"]
