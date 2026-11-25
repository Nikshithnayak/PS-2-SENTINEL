FROM node:22-alpine AS base
RUN corepack enable

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --filter @sentinel/web... --frozen-lockfile || pnpm install --filter @sentinel/web...

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN pnpm --filter @sentinel/web build

EXPOSE 3000
CMD ["pnpm", "--filter", "@sentinel/web", "start"]
