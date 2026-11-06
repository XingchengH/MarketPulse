# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm install --frozen-lockfile && pnpm --filter @marketpulse/contracts build && pnpm --filter @marketpulse/api build
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S marketpulse && adduser -S marketpulse -G marketpulse
COPY --from=build --chown=marketpulse:marketpulse /app/node_modules ./node_modules
COPY --from=build --chown=marketpulse:marketpulse /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=marketpulse:marketpulse /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=marketpulse:marketpulse /app/packages/contracts ./packages/contracts
USER marketpulse
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/health/ready || exit 1
CMD ["node", "apps/api/dist/server.js"]
