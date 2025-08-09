### Polis Modular — Quickstart

Run a local Polis with a simple UI and a configurable number of agents.

### Requirements
- Node.js 18+ and npm
- A Venice API key in your environment or `.env` file: `VENICE_API_KEY=...`

### Install and build
```bash
npm install
npm run build
```

### Start the UI (server)
- Default port is 3000. After starting, open `http://localhost:3000`.
```bash
# optional: set a custom port or DB path
PORT=3000 POLIS_DB=polis.sqlite3 npm run start:server
```

Endpoints available in the UI:
- `/health` – server status
- `/api/passes?limit=50` – most recent agent passes
- `/api/rooms` – current rooms

### Start the agents (orchestrator)
Use the provided CLI to launch agents. By default it runs 3 agents for 60 seconds and writes to `polis.sqlite3`.
```bash
# example: run 10 agents for 10 minutes using the default DB
POLIS_AGENTS=10 POLIS_RUN_SECS=600 npm run start:polis

# optional: specify DB file explicitly (will be created if missing)
POLIS_DB=polis.sqlite3 POLIS_AGENTS=10 POLIS_RUN_SECS=600 npm run start:polis
```

#### Run in the foreground (Ctrl-C to stop)
```bash
cd /home/danny/Documents/source/polis_4
VENICE_API_KEY="$VENICE_API_KEY" \
POLIS_DB=$(pwd)/polis.sqlite3 \
POLIS_AGENTS=10 POLIS_RUN_SECS=315360000 \
node dist/cli/start-polis.js
```
Use a very large `POLIS_RUN_SECS` (e.g., `315360000` ≈ 10 years) to run effectively indefinitely.

Environment variables used:
- `VENICE_API_KEY` – required for model calls (can be set in `.env`)
- `POLIS_AGENTS` – number of agents to launch (default: 3)
- `POLIS_RUN_SECS` – how long to run before stopping (default: 60)
- `POLIS_DB` – SQLite file path (default: `polis.sqlite3` in project root)
- `PORT` – UI server port (default: 3000)

### Monitoring
- Open the dashboard at `http://localhost:3000` and use the Refresh/Auto-refresh controls.
- Programmatic checks:
```bash
curl -s http://localhost:3000/health
curl -s "http://localhost:3000/api/passes?limit=50" | jq .
curl -s http://localhost:3000/api/rooms | jq .
```

### Optional: background + logs
If you prefer running in the background with simple file logs:
```bash
# UI server
PORT=3000 POLIS_DB=$(pwd)/polis.sqlite3 node dist/server/index.js \
  > run/server.log 2>&1 & echo $! > run/server.pid

# Orchestrator (10 agents, 10 minutes)
POLIS_AGENTS=10 POLIS_RUN_SECS=600 POLIS_DB=$(pwd)/polis.sqlite3 node dist/cli/start-polis.js \
  > run/polis.log 2>&1 & echo $! > run/polis.pid

# Tail logs
tail -f run/server.log run/polis.log

# Stop when done
kill $(cat run/polis.pid)
kill $(cat run/server.pid)
kill $(cat run/monitor.pid) 2>/dev/null || true
```

### One-page UI
- Open `http://localhost:3000`
- Tabs: Dashboard (passes, agent filter), Rooms (participants, items, recent activity and chat, admin chat box), Agents (click an agent to view history)

### Notes
- The database schema is created on first run in the specified SQLite file.
- The orchestrator auto-loads the built-in directory and chat toolsets; additional toolsets in `src/lib/tools` are loaded automatically from the built output.
- Rebuild after code changes: `npm run build`.

