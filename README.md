# Polis Modular — Quickstart

Run a local Polis with a simple UI and a configurable number of agents.

## Requirements
- Node.js 18+ and npm
- A Venice API key in your environment or `.env` file: `VENICE_API_KEY=...`

## Install and build
```bash
npm install
npm run build
```

## Set .env
Environment variables used:
- `VENICE_API_KEY` – required for model calls (can be set in `.env`)
- `POLIS_AGENTS` – number of agents to launch (default: 3)
- `POLIS_RUN_SECS` – how long to run before stopping (default: 60)
- `POLIS_DB` – SQLite file path (default: `polis.sqlite3` in project root)
- `PORT` – UI server port (default: 3000)

## Start the Server
- Default port is 3000. After starting, open `http://localhost:3000`.
```bash
# optional: set a custom port or DB path
npm run start:server
```

## Start the Polis
```bash
npm run start:polis
```

### View the Dashboard
- Open the dashboard at `http://localhost:3000` and use the Refresh/Auto-refresh controls.
