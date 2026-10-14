# API + moderator console in one image. Node runs the API's TypeScript directly.
FROM node:22-slim

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/console/package.json apps/console/
RUN pnpm install --frozen-lockfile --filter "@warden/api..." --filter "@warden/console..."

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/console apps/console
RUN pnpm --filter @warden/console build

ENV NODE_ENV=production \
    CONSOLE_DIST=/app/apps/console/dist \
    PORT=8080
USER node
EXPOSE 8080
CMD ["node", "apps/api/src/main.ts"]
