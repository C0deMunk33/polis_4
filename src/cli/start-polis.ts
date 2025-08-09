import 'dotenv/config';
import { AgentOrchestrator } from '../lib/agent-orchestrator';
import { loadAllToolsets } from '../lib/tools/index';

async function main() {
  const numAgents = Number(process.env.POLIS_AGENTS || 3);
  const toolsets = loadAllToolsets();
  const orchestrator = new AgentOrchestrator(toolsets, { includeChat: true, loopIntervalMs: 1500, dbFile: process.env.POLIS_DB || 'polis.sqlite3' });

  for (let i = 0; i < numAgents; i++) {
    orchestrator.createAndAddAgent({ id: `agent-${i+1}`, handle: `Agent${i+1}`, initialInstructions: 'Start in directory: choose a room and introduce yourself in chat, then pick a tool to use.' });
  }

  orchestrator.start();

  const secs = Number(process.env.POLIS_RUN_SECS || 60);
  setTimeout(() => orchestrator.stop(), secs * 1000);
}

main().catch(err => { console.error(err); process.exit(1); });
