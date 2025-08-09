import { AgentOrchestrator } from "../lib/agent-orchestrator";
import { Menu } from "../lib/menu";
import { Toolset } from "../lib/toolset";
import { calculatorToolset, stringToolset, utilityToolset } from "./menu-test";
import { createIdentityToolset } from "../lib/tools/identity";

async function runOrchestratorDemo() {
  console.log("=== ORCHESTRATOR DEMO: 3 Agents in a Shared Polis ===\n");

  const orchestrator = new AgentOrchestrator(
    [createIdentityToolset(), calculatorToolset, stringToolset, utilityToolset],
    {
      includeChat: true,
      chatToolsetName: "Agora",
      loopIntervalMs: 1500,
      onLog: (m) => console.log(m),
      onPassComplete: ({ agentId, intent, followup, toolCalls, executions }) => {
        console.log(`\n[pass-complete] ${agentId}`);
        console.log(`  intent: ${intent}`);
        console.log(`  toolCalls: ${toolCalls.map(t => t.name).join(", ") || "(none)"}`);
        if (executions.length) {
          console.log("  executions:");
          executions.forEach(e => console.log(`    - ${e}`));
        }
        console.log(`  next: ${followup}`);
      }
    }
  );

  orchestrator.createAndAddAgent({
    id: "agent-alpha",
    handle: "Alpha",
    initialInstructions: "Introduce yourself in chat using the Agora tool, then propose a simple computational task to others.",
  });

  orchestrator.createAndAddAgent({
    id: "agent-beta",
    handle: "Beta",
    initialInstructions: "Greet others in chat and ask what task they are working on. Consider formatting the date to schedule a meeting.",
  });

  orchestrator.createAndAddAgent({
    id: "agent-gamma",
    handle: "Gamma",
    initialInstructions: "Say hello in chat, then choose a tool to demonstrate (e.g., add or reverse) and share the result in chat.",
  });

  orchestrator.start();

  await new Promise((res) => setTimeout(res, 40000));
  orchestrator.stop();

  console.log("\n=== ORCHESTRATOR DEMO COMPLETE ===");
}

if (require.main === module) {
  runOrchestratorDemo().catch((err) => {
    console.error("Orchestrator demo failed:", err);
    process.exit(1);
  });
}

export { runOrchestratorDemo };
