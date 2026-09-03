FROM node:20-slim AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/agent/package.json ./apps/agent/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @strixmc/shared build
RUN pnpm --filter @strixmc/agent build

FROM node:20-slim
WORKDIR /app
RUN npm install -g pnpm
# Install docker-cli if you want the agent to manage other containers from within Docker
RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/agent ./apps/agent
RUN pnpm install --prod --filter @strixmc/agent --filter @strixmc/shared
EXPOSE 8081
CMD ["node", "apps/agent/dist/index.js"]
