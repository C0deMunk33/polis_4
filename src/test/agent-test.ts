import { Agent } from "../lib/agent";
import { Menu } from "../lib/menu";
import { ToolCall } from "../lib/toolset";
import { calculatorToolset, stringToolset, utilityToolset } from "./menu-test";

async function testAgent() {
  console.log("=== AGENT TEST (Real API) ===\n");

  // Build a menu with existing toolsets
  const menu = new Menu([calculatorToolset, stringToolset, utilityToolset]);

  // Define pre-pass and post-pass tool calls (used locally for this test)
  const prePassToolCalls: ToolCall[] = [
    { name: "getTime", parameters: {} },
    { name: "formatDate", parameters: { format: "long" } },
  ];

  const postPassToolCalls: ToolCall[] = [];

  const systemPrompt = `You are an autonomous, self-directed agent. You operate in endless passes, continuously evolving objectives and actions.
For each pass:
- Determine a concise 'intent'.
- Provide brief 'agentThoughts' explaining your rationale.
- Choose 0-3 'toolCalls' from [Menu], strictly valid per [Tool Catalog]. Selecting zero toolCalls is acceptable if reflection is more useful.
- Always provide non-empty 'followupInstructions' describing the immediate next step to keep momentum.
Principles:
- Exercise initiative and free will. Avoid stalling; there is always a meaningful next step (action or reflection).
- Be concise and specific. Never fabricate tools or parameters.
Output must strictly follow the provided JSON schema.`;

  let currentInstructions = `Start by computing 5 + 3 using the calculator. Then format the current date in long form. For each subsequent pass, use the results to decide a small next step.`;

  const agent = new Agent(
    "agent-test-1",
    "venice-uncensored",
    systemPrompt,
    menu
  );

  const TOTAL_PASSES = 5;
  for (let i = 1; i <= TOTAL_PASSES; i++) {
    console.log(`\n--- PASS ${i} ---\n`);
    console.log("Running doPass()...\n");

    // Compute simple pre-results for the test
    const preResultsParts: string[] = [];
    for (const call of prePassToolCalls) {
      try {
        const res = menu.callTool(agent, call);
        preResultsParts.push(`- ${call.name}: ${res}`);
      } catch (e) {
        preResultsParts.push(`- ${call.name}: Error ${e}`);
      }
    }
    const preResults = preResultsParts.join("\n");

    const pass = await agent.doPass(currentInstructions, preResults);
    console.log(`Intent: ${pass.intent}`);
    console.log(`Agent Thoughts: ${pass.agentThoughts}`);
    console.log("Pass result (structured):\n", JSON.stringify(pass, null, 2));

    console.log("\nRunning postPass() (executes tool calls) ...\n");
    const execs = await agent.postPass(pass, postPassToolCalls);
    console.log("Post-pass executions:");
    for (const e of execs) console.log("  ", e);

    currentInstructions = pass.followupInstructions || "Propose a concrete next action that builds on results and uses available tools.";
  }

  console.log("\n=== AGENT TEST COMPLETE ===");
}

if (require.main === module) {
  testAgent().catch((err) => {
    console.error("Agent test failed", err);
    process.exit(1);
  });
}

export { testAgent }; 