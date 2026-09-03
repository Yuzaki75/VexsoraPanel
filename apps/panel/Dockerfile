FROM node:20-slim AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/panel/package.json ./apps/panel/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @strixmc/shared build
RUN pnpm --filter @strixmc/panel build

FROM node:20-slim
WORKDIR /app
RUN npm install -g pnpm
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/panel ./apps/panel
RUN pnpm install --prod --filter @strixmc/panel --filter @strixmc/shared
EXPOSE 8080
CMD ["node", "apps/panel/dist/index.js"]
