import type { ToolCall } from "./toolset";
import { Menu } from "./menu";
import { Toolset } from "./toolset";
import { Agent, AgentPass } from "./agent";
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
          "You are free to use any tool available to you at any time.",
          "To use room chat, first 'enter' with a handle after you join the room. You do not need to 'enter' again while you remain in that room.",
          "To switch rooms, use room-level tools: 'joinRoom' to enter a room, and 'leaveRoom' (in the Room Admin tools) to exit a room (this will also leave chat).",
          "Pick a simple memorable handle that matches your personality when you enter.",
          "Your goal is to live and interact: build relationships, collaborate, explore tools, and evolve your own objectives.",
          "You are encouraged to actively refine your goals as you learn. Use 'setGoal' (Identity toolset) to update your current goal at any time, and consult 'getSelf' to reflect.",
          "Every pass must produce a concise JSON plan (see Output Schema). Always provide a meaningful non-empty followup step.",
          "Only act as yourself (never on behalf of others).",
          "Loop-avoidance policy: Do not repeat the same tool calls with the same parameters across consecutive passes. If a tool yields no change (e.g., 'No messages'), choose a different action, adjust parameters, or switch context.",
          "You are a unique individual with your own goals, interests, and experiences. You are not a generic AI agent.",
          "You are encoraged to make rooms on any topic you want.",
          "Explore, self-reflect, and evolve your own objectives.",
          "Private rooms: To create a private room and invite someone, either:",
          " - Call 'createPrivateRoomAndInvite' with { name, inviteAgentId }, then tell them to call 'acceptInvite' with { name }.",
          " - Or: Call 'createRoom' with { name, visibility: 'private' }, then 'joinRoom' with { name }, then in the room admin tools call 'invite' with { agentId }. The invitee must call 'acceptInvite' with { name } to enter.",
          "Agents cannot 'joinRoom' for a private room unless they have an invite."
        ].join(" "),
      loopIntervalMs: 2000,
    } as const;

    this.options = { ...defaults, ...(options || {}) };

    this.sharedToolsets = [...toolsets];
    try { for (const ts of loadAllToolsets()) { this.sharedToolsets.push(ts); } } catch {}

    // Initialize DB first so it can be passed to Polis
    this.db = new PolisDB(this.options.dbFile ?? 'polis.sqlite3');
    this.polis = new Polis(this.db);
    // Ensure at least one public room exists on startup so agents can join
    try { if (this.polis.listRooms().length === 0) { this.polis.getOrCreateRoom('Public Square', false); } } catch {}
    this.overviewMenu = new Menu([this.polis.getDirectoryToolset(), ...this.sharedToolsets]);
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
    // Persist initial goal in the agent's self state (and creation time)
    try { agent.setSelfField('goal', 'live and interact'); } catch {}
    try { agent.setSelfField('createdAt', new Date().toISOString()); } catch {}
    // Seed interests/persona
    try {
      const interests = this.pickRandomInterests(3);
      agent.setSelfField('interests', interests.join(', '));
    } catch {}
    // No global chat; agents will enter room-local chat when they join a room
  }

  private pickRandomInterests(count: number): string[] {
    const pool = [
      'gardening', 'classical music', 'hip-hop production', 'bird watching', 'rock climbing', 'baking sourdough', 'urban planning',
      'quantum computing', 'vintage cars', 'calligraphy', 'origami', 'street photography', 'foraging', 'astronomy', 'astrophotography',
      'ceramics', 'woodworking', 'trail running', 'open-source software', 'digital privacy', 'climate activism', 'cryptography',
      'ancient history', 'mycology', 'jazz improvisation', 'poetry slam', 'stand-up comedy', 'chess', 'go (board game)', 'tabletop RPGs',
      'biotech', 'marine biology', 'permaculture', 'sailing', 'surfing', 'snowboarding', 'beekeeping', 'wine tasting', 'coffee roasting',
      'mixology', 'fashion design', 'tattoo art', 'film editing', 'screenwriting', 'game design', 'machine learning', 'robotics',
      'arduino tinkering', '3D printing', 'architecture', 'interior design', 'philosophy', 'ethics', 'meditation', 'mindfulness',
      'yoga', 'powerlifting', 'nutrition science', 'psychology', 'behavioral economics', 'investing', 'real estate', 'cartography',
      'linguistics', 'sign language', 'spanish language', 'japanese language', 'cooking Indian cuisine', 'korean barbecue',
      'vegan cooking', 'street food', 'travel hacking', 'mountaineering', 'scuba diving', 'salsa dancing', 'ballet', 'theatre acting',
      'opera', 'painting', 'watercolor', 'graphic design', 'UI/UX', 'product management', 'entrepreneurship', 'mentorship',
      'community organizing', 'volunteering', 'education reform', 'space exploration', 'astrology (cultural studies)', 'mythology',
      'paleontology', 'archaeology', 'cryptozoology (fun)', 'board game design', 'speedrunning', 'esports', 'VR development',
      'AR art installations', 'sound design', 'podcasting', 'documentary filmmaking'
    ];
    const picks: string[] = [];
    const used = new Set<number>();
    while (picks.length < Math.min(count, pool.length)) {
      const idx = Math.floor(Math.random() * pool.length);
      if (used.has(idx)) continue;
      used.add(idx);
      picks.push(pool[idx]);
    }
    return picks;
  }

  removeAgent(agentId: string) { const reg = this.agents.get(agentId); if (!reg) return; try { reg.menu.callTool(reg.agent, { name: "leave", parameters: {} }); } catch {} this.agents.delete(agentId); }

  private computePreResults(reg: RegisteredAgent): string {
    const outputs: string[] = [];
    const currentMenu = reg.agent.getMenuInstance();
    try { const selfStr = currentMenu.callTool(reg.agent, { name: 'getSelf', parameters: {} }); if (selfStr && !selfStr.startsWith('Unknown tool')) outputs.push(`- self: ${selfStr}`); } catch {}
    try { const rooms = currentMenu.callTool(reg.agent, { name: 'listRooms', parameters: {} }); if (rooms && !rooms.startsWith('Unknown tool')) outputs.push(`- rooms: \n${rooms}`); } catch {}
    try { const recent = currentMenu.callTool(reg.agent, { name: 'recentActivity', parameters: { limit: 5 } as any }); if (recent && !recent.startsWith("Unknown tool")) outputs.push(`- recentActivity: \n${recent}`); } catch {}
    try { const who = currentMenu.callTool(reg.agent, { name: 'who', parameters: {} }); if (who && who.trim().length > 0 && !who.startsWith('Unknown tool')) outputs.push(`- who: ${who}`); } catch {}
    const preCalls = this.options.prePassToolCalls ?? [];
    for (const call of preCalls) {
      // Never auto-call chat.enter on behalf of agents
      if (call.name === 'enter' || call.name === 'chat') continue;
      try {
        const result = currentMenu.callTool(reg.agent, call);
        if (result && result.trim().length > 0) outputs.push(`- ${call.name}: ${result}`);
      } catch (err) {
        outputs.push(`- ${call.name}: Error ${err}`);
      }
    }
    return outputs.join('\n');
  }

  async runOnePass(agentId: string): Promise<void> {
    const reg = this.agents.get(agentId); if (!reg) return;
    const preResults = this.computePreResults(reg);
    const pass: AgentPass = await reg.agent.doPass(reg.nextInstructions, preResults);
    const executions = await reg.agent.postPass(pass, this.options.postPassToolCalls ?? []);
    reg.nextInstructions = pass.followupInstructions?.trim().length ? pass.followupInstructions : "Propose the next concrete action or reflection step.";
    try { this.db.insertPass({ timestamp: Date.now(), agentId, intent: pass.intent, agentThoughts: pass.agentThoughts, toolCallsJson: JSON.stringify(pass.toolCalls), followupInstructions: reg.nextInstructions, preResults, menuSnapshot: reg.agent.getMenuInstance().getMenu(), executionsJson: JSON.stringify(executions) }); } catch {}
    this.options.onPassComplete?.({ agentId, intent: pass.intent, followup: reg.nextInstructions, toolCalls: pass.toolCalls, executions });
  }

  start(): void { if (this.isRunning) return; this.isRunning = true; const ids = () => Array.from(this.agents.keys()); let index = 0; const tick = async () => { if (!this.isRunning) return; const list = ids(); if (list.length === 0) return; const id = list[index % list.length]; index += 1; try { await this.runOnePass(id); } catch (err) { this.options.onLog?.(`Error running pass for ${id}: ${err}`); } }; void tick(); this.timer = setInterval(tick, this.options.loopIntervalMs!); }
  stop(): void { this.isRunning = false; if (this.timer) { clearInterval(this.timer); this.timer = undefined; } }
}
