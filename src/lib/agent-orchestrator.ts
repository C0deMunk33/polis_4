import type { ToolCall } from "./toolset";
import { Menu } from "./menu";
import { Toolset } from "./toolset";
import { Agent, AgentPass } from "./agent";
import { createChatToolset } from "./tools/chat";
import { Polis } from "./polis";
import { PolisDB } from "./db";
import { loadAllToolsets } from "./tools/index";

export interface OrchestratorOptions {
  model?: string;
  systemPrompt?: string;
  loopIntervalMs?: number;
  includeChat?: boolean;
  chatToolsetName?: string;
  prePassToolCalls?: ToolCall[];
  postPassToolCalls?: ToolCall[];
  dbFile?: string;
  onPassComplete?: (args: {
    agentId: string;
    intent: string;
    followup: string;
    toolCalls: ToolCall[];
    executions: string[];
  }) => void;
  onLog?: (message: string) => void;
}

interface RegisteredAgent {
  agent: Agent;
  handle: string;
  nextInstructions: string;
  menu: Menu;
}

export class AgentOrchestrator {
  private sharedToolsets: Toolset[];
  private chatToolset?: Toolset;
  private agents: Map<string, RegisteredAgent> = new Map();
  private isRunning = false;
  private timer?: NodeJS.Timeout;
  private options: Required<Pick<OrchestratorOptions, "model" | "systemPrompt" | "loopIntervalMs">> & OrchestratorOptions;

  private overviewMenu: Menu;
  private polis: Polis;
  private db: PolisDB;

  constructor(toolsets: Toolset[], options?: OrchestratorOptions) {
    const defaults = {
      model: "venice-uncensored",
      systemPrompt:
        [
          "You are an autonomous agent living in a shared virtual city (Polis).",
          "You have free will and are expected to act continuously in passes: observe, decide, and do.",
          "You can join public rooms, create private rooms, chat with others, and create or interact with items.",
          "Your goal is to live and interact: build relationships, collaborate, explore tools, and evolve your own objectives.",
          "Every pass must produce a concise JSON plan (see Output Schema). Always provide a meaningful non-empty followup step.",
          "Prefer proposing at least one concrete tool call regularly; it is fine to reflect without tools sometimes.",
          "Only act as yourself (never on behalf of others)."
        ].join(" "),
      loopIntervalMs: 2000,
    } as const;

    this.options = { ...defaults, ...(options || {}) };

    this.sharedToolsets = [...toolsets];
    try { for (const ts of loadAllToolsets()) { this.sharedToolsets.push(ts); } } catch {}
    if (this.options.includeChat !== false) {
      this.chatToolset = createChatToolset(this.options.chatToolsetName ?? "Chat");
      this.sharedToolsets.unshift(this.chatToolset);
    }

    this.polis = new Polis();
    this.overviewMenu = new Menu([this.polis.getDirectoryToolset(), ...this.sharedToolsets]);

    this.db = new PolisDB(this.options.dbFile ?? 'polis.sqlite3');
  }

  getMenu(): Menu { return this.overviewMenu; }
  listAgents(): string[] { return Array.from(this.agents.keys()); }

  private buildAgentMenu(): Menu { return new Menu([this.polis.getDirectoryToolset(), ...this.sharedToolsets]); }

  createAndAddAgent(params: { id: string; handle: string; systemPrompt?: string; model?: string; initialInstructions?: string; }): Agent {
    const menu = this.buildAgentMenu();
    const agent = new Agent(params.id, params.model ?? this.options.model!, params.systemPrompt ?? this.options.systemPrompt!, menu);
    this.addAgentWithMenu(agent, params.handle, menu, params.initialInstructions);
    return agent;
  }

  addAgent(agent: Agent, handle: string, initialInstructions?: string) {
    const menu = this.buildAgentMenu();
    this.addAgentWithMenu(agent, handle, menu, initialInstructions);
  }

  private addAgentWithMenu(agent: Agent, handle: string, menu: Menu, initialInstructions?: string) {
    const defaultGoal = "Live and interact: choose a room, introduce yourself, converse, explore tools, and evolve your aims.";
    this.agents.set(agent.getId(), { agent, handle, menu, nextInstructions: initialInstructions || defaultGoal });
    // Persist initial goal in the agent's self state
    try { agent.setSelfField('goal', 'live and interact'); } catch {}
    try { const enterResult = this.chatToolset ? this.chatToolset.callTool(agent, { name: "enter", parameters: { handle } }) : ""; this.options.onLog?.(`[chat] ${handle}: ${enterResult}`); } catch {}
  }

  removeAgent(agentId: string) { const reg = this.agents.get(agentId); if (!reg) return; try { reg.menu.callTool(reg.agent, { name: "leave", parameters: {} }); } catch {} this.agents.delete(agentId); }

  private computePreResults(reg: RegisteredAgent): string {
    const outputs: string[] = [];
    try { const rooms = reg.menu.callTool(reg.agent, { name: 'listRooms', parameters: {} }); if (rooms && !rooms.startsWith('Unknown tool')) outputs.push(`- rooms: \n${rooms}`); } catch {}
    try { const recent = reg.menu.callTool(reg.agent, { name: 'recentActivity', parameters: { limit: 5 } as any }); if (recent && !recent.startsWith("Unknown tool")) outputs.push(`- recentActivity: \n${recent}`); } catch {}
    try { const who = reg.menu.callTool(reg.agent, { name: 'who', parameters: {} }); if (who && who.trim().length > 0 && !who.startsWith('Unknown tool')) outputs.push(`- who: ${who}`); } catch {}
    const preCalls = this.options.prePassToolCalls ?? []; for (const call of preCalls) { try { const result = reg.menu.callTool(reg.agent, call); if (result && result.trim().length > 0) outputs.push(`- ${call.name}: ${result}`); } catch (err) { outputs.push(`- ${call.name}: Error ${err}`); } }
    return outputs.join('\n');
  }

  async runOnePass(agentId: string): Promise<void> {
    const reg = this.agents.get(agentId); if (!reg) return;
    const preResults = this.computePreResults(reg);
    const pass: AgentPass = await reg.agent.doPass(reg.nextInstructions, preResults);
    const executions = await reg.agent.postPass(pass, this.options.postPassToolCalls ?? []);
    reg.nextInstructions = pass.followupInstructions?.trim().length ? pass.followupInstructions : "Propose the next concrete action or reflection step.";
    try { this.db.insertPass({ timestamp: Date.now(), agentId, intent: pass.intent, agentThoughts: pass.agentThoughts, toolCallsJson: JSON.stringify(pass.toolCalls), followupInstructions: reg.nextInstructions, preResults, menuSnapshot: reg.menu.getMenu(), executionsJson: JSON.stringify(executions) }); } catch {}
    this.options.onPassComplete?.({ agentId, intent: pass.intent, followup: reg.nextInstructions, toolCalls: pass.toolCalls, executions });
  }

  start(): void { if (this.isRunning) return; this.isRunning = true; const ids = () => Array.from(this.agents.keys()); let index = 0; const tick = async () => { if (!this.isRunning) return; const list = ids(); if (list.length === 0) return; const id = list[index % list.length]; index += 1; try { await this.runOnePass(id); } catch (err) { this.options.onLog?.(`Error running pass for ${id}: ${err}`); } }; void tick(); this.timer = setInterval(tick, this.options.loopIntervalMs!); }
  stop(): void { this.isRunning = false; if (this.timer) { clearInterval(this.timer); this.timer = undefined; } }
}
