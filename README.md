# StrixMC — Lightweight Multi-Game Server Panel

A Pterodactyl-style game server management panel built as a TypeScript monorepo. Panel + agent + web UI in one language, SQLite instead of MySQL, no PHP. Own lightweight node agent (like Wings) with Docker isolation **plus** a native (no-Docker) mode so it runs on any box, including your Windows dev machine.

## Features

**✅ Complete v1:**
- Multi-runtime (Docker containers + native/no-Docker mode)
- Panel API (Hono + SQLite + Drizzle ORM)
- Agent daemon with WebSocket console streaming
- JSON-based game templates (Paper, Vanilla, Fabric, Terraria, Valheim, etc.)
- Authentication (Argon2id, TOTP 2FA, API keys)
- Granular per-server permissions for subusers
- File browser & text editor
- On-demand backups & restoration
- Real-time CPU/RAM/network stats & graphs
- Webhook notifications (Discord-compatible)
- Admin panel (nodes, users, templates)

**🔜 Post-v1:**
- Scheduled tasks (cron)
- Marketplace for community templates
- Plugin system
- Clustering (panel high-availability)

## Architecture

```
Browser ──(REST + WS)── Panel ──(HTTPS/WSS, token auth)── Agent(s) ── Docker/native ── game servers
```

## Quick Start

### 1. Install dependencies
```bash
pnpm install
```

### 2. Set up the panel
```bash
# Start the panel (listens on http://localhost:8080)
cd apps/panel
pnpm dev

# First-time setup: register a user at http://localhost:8080/register
```

### 3. Set up an agent node
```bash
# Start the agent (listens on http://localhost:8081)
cd apps/agent
pnpm dev

# Agent will prompt for join token
# Get join token from panel admin → nodes → add node
```

### 4. Start the web UI
```bash
cd apps/web
pnpm dev

# Access UI at http://localhost:3000
```

### 5. Create a server
1. Log into panel at http://localhost:3000
2. Go to Admin → Templates to see available games
3. Go to Admin → Nodes to add your agent node
4. Go to Servers → Create server
5. Choose template, assign resources, and deploy

## Development

```bash
# Start everything (panel + agent + web) in dev mode
pnpm dev

# Start individual services
pnpm dev:panel
pnpm dev:agent
pnpm dev:web

# Build for production
pnpm build

# Type check
pnpm typecheck

# Run tests
pnpm test
```

## Deployment

### Docker Compose (recommended for production)
```yaml
# docker-compose.yml
version: "3.8"
services:
  panel:
    image: strixmc/panel:latest
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/app/data/strix.db
    restart: unless-stopped

  agent:
    image: strixmc/agent:latest
    ports:
      - "8081:8081"
    volumes:
      - ./servers:/app/servers
      - /var/run/docker.sock:/var/run/docker.sock  # For Docker runtime
    environment:
      - PANEL_URL=http://panel:8080
      - JOIN_TOKEN=<join_token_from_panel>
    restart: unless-stopped

  web:
    build: ./apps/web
    ports:
      - "3000:80"
    depends_on:
      - panel
    restart: unless-stopped
```

### Bare-metal
```bash
# Build all packages
pnpm build

# Copy built files to production server
rsync -av dist/ user@server:/opt/strixmc/

# Set up systemd service for panel & agent
```

## Project Structure

```
StrixMC/
├── package.json / pnpm-workspace.yaml / tsconfig.base.json
├── apps/
│   ├── panel/          # Main API server
│   │   ├── src/
│   │   │   ├── auth/   # Authentication, sessions, TOTP, API keys
│   │   │   ├── db/     # Drizzle schema & migrations
│   │   │   ├── proxy/  # Agent REST forwarder + WS console pipe
│   │   │   ├── routes/ # REST endpoints
│   │   │   ├── templates.ts
│   │   │   ├── webhooks.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── agent/          # Node agent daemon
│   │   ├─��� src/
│   │   │   ├── runtime/   # Docker + native implementations
│   │   │   ├── console.ts # Ring buffer + WebSocket
│   │   │   ├── files.ts    # File operations
│   │   │   ├── backups.ts  # Backup creation/restore
│   │   │   ├── serverManager.ts
│   │   │   └── index.ts
│   │   └── package.json
│   └── web/            # React SPA frontend
│       ├── src/
│       │   ├── contexts/  # Auth context, etc.
│       │   ├── layouts/   # Dashboard layout
│       │   ├── pages/     # All page components
│       │   └── lib/       # API client, utilities
│       └── package.json
├── packages/
│   └── shared/         # Zod schemas, protocol, permissions, types
└── templates/          # JSON game templates
```

## Configuration

### Panel (.env or environment variables)
```bash
PORT=8080
HOST=0.0.0.0
DATABASE_URL=file:./data/strix.db
WEB_DIST=./web/dist
TEMPLATE_DIR=./templates
```

### Agent (.env or environment variables)
```bash
PORT=8081
HOST=0.0.0.0
PANEL_URL=http://localhost:8080
JOIN_TOKEN=<join_token>
DATA_DIR=./data
VERSION=dev
HEARTBEAT_SEC=30
```

## Templates

Templates are JSON files in `templates/` that define:
- Docker image (or blank for native mode)
- Install script (bash)
- Start command
- Config file templates with `{{VAR}}` substitution
- Required environment variables (memory, port, version, etc.)

Example template (`templates/paper.json`):
```json
{
  "id": "paper",
  "name": "Paper Minecraft",
  "game": "minecraft",
  "description": "High-performance Minecraft server",
  "dockerImage": "eclipse-temurin:21-jre",
  "startCommand": "java -Xms128M -Xmx${SERVER_MEMORY}M -jar paper.jar",
  "variables": [
    { "key": "MC_VERSION", "label": "Minecraft version", "default": "latest" },
    { "key": "MOTD", "label": "Message of the day", "default": "A StrixMC Server" }
  ],
  "configs": [
    {
      "path": "server.properties",
      "content": "server-port={{SERVER_PORT}}\nmotd={{MOTD}}\n"
    }
  ]
}
```

## API Documentation

- `GET /api/v1/auth/me` - Get current user
- `POST /api/v1/auth/login` - Login with email/password (+TOTP)
- `POST /api/v1/auth/register` - Register new account
- `GET /api/v1/servers` - List servers (with permissions)
- `POST /api/v1/servers` - Create new server
- `GET /api/v1/servers/:id/console` - WebSocket console stream
- `POST /api/v1/servers/:id/power` - Start/stop/restart/kill
- `GET /api/v1/servers/:id/files` - List files in server directory
- `POST /api/v1/servers/:id/backups` - Create backup
- `GET /api/v1/nodes` - List agent nodes (admin)
- `GET /api/v1/templates` - List available templates

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT
