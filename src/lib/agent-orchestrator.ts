import type { ToolCall } from "./toolset";
import { Menu } from "./menu";
import { Toolset } from "./toolset";
import { Agent, AgentPass } from "./agent";
import { createChatToolset } from "./tools/chat";

export interface OrchestratorOptions {
  model?: string;
  systemPrompt?: string;
  loopIntervalMs?: number;
  includeChat?: boolean;
  chatToolsetName?: string;
  prePassToolCalls?: ToolCall[];
  postPassToolCalls?: ToolCall[];
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

  // A convenience menu composed of the shared toolsets only (not used by agents)
  private overviewMenu: Menu;

  constructor(toolsets: Toolset[], options?: OrchestratorOptions) {
    const defaults = {
      model: "venice-uncensored",
      systemPrompt:
        "You are an autonomous agent living in a shared polis. You act in endless passes, evolving goals and collaborating via shared tools.",
      loopIntervalMs: 2000,
    } as const;

    this.options = { ...defaults, ...(options || {}) };

    // Optionally include a shared chat toolset
    this.sharedToolsets = [...toolsets];
    if (this.options.includeChat !== false) {
      this.chatToolset = createChatToolset(this.options.chatToolsetName ?? "Chat");
      this.sharedToolsets.unshift(this.chatToolset);
    }

    this.overviewMenu = new Menu(this.sharedToolsets);
  }

  getMenu(): Menu {
    return this.overviewMenu;
  }

  listAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  private buildAgentMenu(): Menu {
    // Each agent gets its own Menu with independent currentToolset pointer,
    // but all Toolset instances are shared to preserve shared state where applicable.
    return new Menu(this.sharedToolsets);
  }

  createAndAddAgent(params: {
    id: string;
    handle: string;
    systemPrompt?: string;
    model?: string;
    initialInstructions?: string;
  }): Agent {
    const menu = this.buildAgentMenu();
    const agent = new Agent(
      params.id,
      params.model ?? this.options.model!,
      params.systemPrompt ?? this.options.systemPrompt!,
      menu
    );

    this.addAgentWithMenu(agent, params.handle, menu, params.initialInstructions);
    return agent;
  }

  addAgent(agent: Agent, handle: string, initialInstructions?: string) {
    const menu = this.buildAgentMenu();
    // NOTE: This will replace the agent's internal menu only if it matches runtime expectations.
    // Prefer createAndAddAgent for new agents.
    this.addAgentWithMenu(agent, handle, menu, initialInstructions);
  }

  private addAgentWithMenu(agent: Agent, handle: string, menu: Menu, initialInstructions?: string) {
    this.agents.set(agent.getId(), {
      agent,
      handle,
      menu,
      nextInstructions:
        initialInstructions ||
        "Continue evolving your goals with concrete next steps or concise reflection.",
    });

    // Auto-enter shared chat if available
    try {
      const enterResult = menu.callTool(agent, { name: "enter", parameters: { handle } });
      this.options.onLog?.(`[chat] ${handle}: ${enterResult}`);
    } catch {
      // ignore if chat not present
    }
  }

  removeAgent(agentId: string) {
    const reg = this.agents.get(agentId);
    if (!reg) return;
    try {
      reg.menu.callTool(reg.agent, { name: "leave", parameters: {} });
    } catch {
      // ignore
    }
    this.agents.delete(agentId);
  }

  private computePreResults(reg: RegisteredAgent): string {
    const outputs: string[] = [];

    // Standing presence check if chat is available
    try {
      const whoResult = reg.menu.callTool(reg.agent, { name: 'who', parameters: {} });
      if (whoResult && whoResult.trim().length > 0 && whoResult !== 'Unknown tool: who') {
        outputs.push(`- who: ${whoResult}`);
      }
    } catch {}

    // Configured pre-pass tool calls
    const preCalls = this.options.prePassToolCalls ?? [];
    for (const call of preCalls) {
      try {
        const result = reg.menu.callTool(reg.agent, call);
        if (result && result.trim().length > 0) {
          outputs.push(`- ${call.name}: ${result}`);
        }
      } catch (err) {
        outputs.push(`- ${call.name}: Error ${err}`);
      }
    }

    return outputs.join('\n');
  }

  async runOnePass(agentId: string): Promise<void> {
    const reg = this.agents.get(agentId);
    if (!reg) return;

    const preResults = this.computePreResults(reg);
    const pass: AgentPass = await reg.agent.doPass(reg.nextInstructions, preResults);
    const executions = await reg.agent.postPass(pass, this.options.postPassToolCalls ?? []);

    // Update next instructions
    reg.nextInstructions = pass.followupInstructions?.trim().length
      ? pass.followupInstructions
      : "Propose the next concrete action or reflection step.";

    this.options.onPassComplete?.({
      agentId,
      intent: pass.intent,
      followup: reg.nextInstructions,
      toolCalls: pass.toolCalls,
      executions,
    });
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const ids = () => Array.from(this.agents.keys());
    let index = 0;
    const tick = async () => {
      if (!this.isRunning) return;
      const list = ids();
      if (list.length === 0) return;
      const id = list[index % list.length];
      index += 1;

      try {
        await this.runOnePass(id);
      } catch (err) {
        this.options.onLog?.(`Error running pass for ${id}: ${err}`);
      }
    };

    void tick();
    this.timer = setInterval(tick, this.options.loopIntervalMs!);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
