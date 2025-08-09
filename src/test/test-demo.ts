import { testMenu } from "./menu-test";
import { testAgent } from "./agent-test";
import { runOrchestratorDemo } from "./orchestrator-demo";
import { runPolisDemo } from "./polis-demo";

// Run the menu test
testMenu();

// Run the agent test
(async () => {
  try {
    await testAgent();
  } catch (e) {
    console.error(e);
  }
})();

// Run the orchestrator demo after the agent test
(async () => {
  try {
    await runOrchestratorDemo();
  } catch (e) {
    console.error(e);
  }
})();

// Run the polis demo at the end
(async () => {
  try {
    await runPolisDemo();
  } catch (e) {
    console.error(e);
  }
})(); 