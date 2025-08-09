import { Polis } from "../lib/polis";
import { Agent } from "../lib/agent";
import { Menu } from "../lib/menu";
import { createIdentityToolset } from "../lib/tools/identity";

async function runPolisDemo() {
  console.log("=== POLIS DEMO ===\n");

  const polis = new Polis();

  // Each agent initially has a directory menu + identity
  const baseMenuA = new Menu([polis.getDirectoryToolset(), createIdentityToolset()]);
  const baseMenuB = new Menu([polis.getDirectoryToolset(), createIdentityToolset()]);
  const baseMenuC = new Menu([polis.getDirectoryToolset(), createIdentityToolset()]);

  const a1 = new Agent("agent-a1", "venice-uncensored", "You are an autonomous agent in a polis.", baseMenuA);
  const a2 = new Agent("agent-a2", "venice-uncensored", "You are an autonomous agent in a polis.", baseMenuB);
  const a3 = new Agent("agent-a3", "venice-uncensored", "You are an autonomous agent in a polis.", baseMenuC);

  // Setup rooms via agent a1 calling the directory tools
  console.log(a1.getMenuInstance().callTool(a1, { name: "createRoom", parameters: { name: "Agora", visibility: "public" } }));
  console.log(a1.getMenuInstance().callTool(a1, { name: "createRoom", parameters: { name: "Workshop", visibility: "public" } }));
  console.log(a1.getMenuInstance().callTool(a1, { name: "createRoom", parameters: { name: "Council", visibility: "private" } }));
  console.log();

  // Agents set handles and join Agora
  console.log(a1.setHandle("Alpha"));
  console.log(a2.setHandle("Beta"));
  console.log(a3.setHandle("Gamma"));
  console.log();

  console.log(a1.getMenuInstance().callTool(a1, { name: "joinRoom", parameters: { name: "Agora" } }));
  console.log(a2.getMenuInstance().callTool(a2, { name: "joinRoom", parameters: { name: "Agora" } }));
  console.log(a3.getMenuInstance().callTool(a3, { name: "joinRoom", parameters: { name: "Agora" } }));
  console.log();

  // Chat in Agora
  console.log(a1.getMenuInstance().callTool(a1, { name: "chat", parameters: { content: "Hello from Alpha in Agora" } }));
  console.log(a2.getMenuInstance().callTool(a2, { name: "chat", parameters: { content: "Hi Alpha, Beta here" } }));
  console.log(a3.getMenuInstance().callTool(a3, { name: "chat", parameters: { content: "Gamma joining the discussion" } }));
  console.log();

  // Create an item in Agora
  console.log(a1.getMenuInstance().callTool(a1, { name: "createItem", parameters: { description: "A simple shared counter device", creationPrompt: "Starts at zero" } }));

  // List items
  console.log(a2.getMenuInstance().callTool(a2, { name: "listItems", parameters: {} }));

  // Interact with item 0 (anyone can interact)
  console.log(a2.getMenuInstance().callTool(a2, { name: "interact", parameters: { index: 0, interaction: "increment", inputs: JSON.stringify({ amount: "1" }) } }));

  // Make private room invite and join
  const council = polis.getRoom("Council");
  if (council) {
    console.log(council.admin.callTool(a1, { name: "invite", parameters: { agentId: a2.getId() } }));
    console.log(a2.getMenuInstance().callTool(a2, { name: "acceptInvite", parameters: { name: "Council" } }));
    console.log(a2.getMenuInstance().callTool(a2, { name: "chat", parameters: { content: "Beta in Council now." } }));
  } else {
    console.log("Council room missing");
  }

  console.log("\n=== POLIS DEMO COMPLETE ===");
}

if (require.main === module) {
  runPolisDemo().catch(err => {
    console.error("Polis demo failed:", err);
    process.exit(1);
  });
}

export { runPolisDemo };
