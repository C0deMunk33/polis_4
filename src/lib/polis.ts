import { Menu } from "./menu";
import { Toolset, ToolCall, ToolSchema } from "./toolset";
import { createChatToolset } from "./tools/chat";
import { Agent } from "./agent";
import { ItemsHelpers, Item } from "./items";
import { PolisDB } from "./db";

interface RoomItem {
  ownerId: string;
  item: Item;
}

export class Room {
  name: string;
  isPrivate: boolean;
  invites: Set<string> = new Set();
  items: RoomItem[] = [];

  readonly chat: Toolset;
  readonly admin: Toolset;
  readonly itemsToolset: Toolset;
  readonly menu: Menu;

  constructor(private polis: Polis, name: string, isPrivate: boolean) {
    this.name = name;
    this.isPrivate = isPrivate;

    this.chat = createChatToolset(`${name}: Chat`, (entry) => {
      try {
        this.polis.onChatMessage?.(this.name, entry);
      } catch {}
    });
    this.itemsToolset = this.createRoomItemsToolset();
    this.admin = this.createRoomAdminToolset();

    this.menu = new Menu([this.chat, this.itemsToolset, this.admin]);
  }

  // Snapshot for UI rendering
  getSnapshot(limitMessages: number = 8) {
    const chatTs: any = this.chat as any;
    const recent = typeof chatTs.getRecentMessages === 'function' ? chatTs.getRecentMessages(limitMessages) : [];
    const participants = typeof chatTs.getParticipants === 'function' ? chatTs.getParticipants() : [];
    const itemsList = this.items.map((ri, idx) => ({ index: idx, name: ri.item.template.name, ownerId: ri.ownerId }));
    return { name: this.name, isPrivate: this.isPrivate, participants, items: itemsList, recentChat: recent };
  }

  private createRoomAdminToolset(): Toolset {
    const tools: ToolSchema[] = [
      { name: "roomInfo", description: "Get current room info", parameters: [] },
      { name: "invite", description: "Invite an agentId to this room", parameters: [
        { name: "agentId", description: "Agent id to invite", type: "string", enum: [], default: "" }
      ]},
      { name: "makePrivate", description: "Make this room private", parameters: [] },
      { name: "makePublic", description: "Make this room public", parameters: [] },
      { name: "recentActivity", description: "Show recent chat and item overview", parameters: [
        { name: "limit", description: "Max chat messages to show", type: "number", enum: [], default: "5" }
      ]},
      { name: "returnToDirectory", description: "Return to the polis room directory", parameters: [] }
    ];

    const callback = (agent: Agent | undefined, toolcall: ToolCall): string => {
      if (!agent) return "Error: agent required";
      switch (toolcall.name) {
        case "roomInfo":
          return `${this.name} | ${this.isPrivate ? "private" : "public"} | items: ${this.items.length} | invites: ${this.invites.size}`;
        case "invite": {
          const { agentId } = toolcall.parameters as any;
          if (!agentId) return "Error: agentId required";
          this.invites.add(String(agentId));
          return `Invited #${agentId} to ${this.name}`;
        }
        case "makePrivate":
          this.isPrivate = true;
          return `Room ${this.name} is now private`;
        case "makePublic":
          this.isPrivate = false;
          return `Room ${this.name} is now public`;
        case "recentActivity": {
          const limit = Number((toolcall.parameters as any).limit ?? 5);
          let chat = "";
          try {
            // Use DB-backed recent chat and personalize own messages as "You"; cap to 20
            chat = this.polis.getRecentChatText(this.name, Math.min(20, limit), agent.getId());
          } catch { chat = "(chat unavailable)"; }
          const itemsList = this.items.length === 0 ? "No items" : this.items.map((ri, idx) => `[${idx}] ${ri.item.template.name} (owner:#${ri.ownerId})`).join("\n");
          return `Room: ${this.name}\nItems:\n${itemsList}\n\nRecent Chat:\n${chat}`;
        }
        case "returnToDirectory":
          agent.setMenu(this.polis.getDirectoryMenu());
          return `Returned to directory`;
        default:
          return `Unknown tool: ${toolcall.name}`;
      }
    };

    return new Toolset(`${this.name}: Room Admin`, tools, { toolsetName: `${this.name}: Room Admin`, callback });
  }

  private createRoomItemsToolset(): Toolset {
    const tools: ToolSchema[] = [
      { name: "listItems", description: "List items in room", parameters: [] },
      { name: "createItem", description: "Create an item in this room (you will own it)", parameters: [
        { name: "description", description: "Template description", type: "string", enum: [], default: "" },
        { name: "creationPrompt", description: "Creation prompt for initial state", type: "string", enum: [], default: "" }
      ]},
      { name: "interact", description: "Interact with an item", parameters: [
        { name: "index", description: "Item index", type: "number", enum: [], default: "0" },
        { name: "interaction", description: "Interaction name", type: "string", enum: [], default: "" },
        { name: "inputs", description: "JSON of inputs", type: "string", enum: [], default: "{}" }
      ]},
      { name: "removeItem", description: "Remove an item you own", parameters: [
        { name: "index", description: "Item index", type: "number", enum: [], default: "0" }
      ]},
      { name: "myItems", description: "List items you own", parameters: [] }
    ];

    const callback = async (agent: Agent | undefined, toolcall: ToolCall): Promise<string> => {
      if (!agent) return "Error: agent required";
      try {
        switch (toolcall.name) {
          case "listItems": {
            if (this.items.length === 0) return "No items";
            return this.items.map((ri, idx) => `[${idx}] ${ri.item.template.name} (owner:#${ri.ownerId})`).join("\n");
          }
          case "myItems": {
            const me = agent.getId();
            const mine = this.items
              .map((ri, idx) => ({ ri, idx }))
              .filter(e => e.ri.ownerId === me);
            if (mine.length === 0) return "You own no items";
            return mine.map(e => `[${e.idx}] ${e.ri.item.template.name}`).join("\n");
          }
          case "createItem": {
            const { description, creationPrompt } = toolcall.parameters as any;
            if (!description) return "Error: description required";
            const ownerId = agent.getId();
            const template = await ItemsHelpers.createTemplate(String(description));
            const newItem = await Item.create(template, String(creationPrompt ?? ""));
            this.items.push({ ownerId, item: newItem });
            return `Created item '${newItem.template.name}' (owner:#${ownerId})`;
          }
          case "interact": {
            const { index, interaction, inputs } = toolcall.parameters as any;
            const idx = Number(index);
            const entry = this.items[idx];
            if (!entry) return `Error: item ${idx} not found`;
            let parsedInputs: Record<string, string> = {};
            try { parsedInputs = inputs ? JSON.parse(inputs) : {}; } catch { return "Error: invalid JSON for inputs"; }
            await entry.item.interact({ interaction, inputs: parsedInputs, intent: `Agent ${agent.getHandle?.() ?? agent.getId()} interacts` });
            return `Interaction '${interaction}' completed on ${entry.item.template.name}`;
          }
          case "removeItem": {
            const idx = Number((toolcall.parameters as any).index);
            const entry = this.items[idx];
            if (!entry) return `Error: item ${idx} not found`;
            if (entry.ownerId !== agent.getId()) return "Error: only the owner can remove this item";
            this.items.splice(idx, 1);
            return `Removed item ${idx}`;
          }
        }
      } catch (e) {
        return `Error: ${e}`;
      }
      return `Unknown tool: ${toolcall.name}`;
    };

    return new Toolset(`${this.name}: Items`, tools, { toolsetName: `${this.name}: Items`, callback } as any);
  }
}

export class Polis {
  private rooms = new Map<string, Room>();
  private directoryToolset: Toolset;
  private directoryMenu: Menu;
  private db?: PolisDB;

  constructor(db?: PolisDB) {
    this.db = db;
    this.directoryToolset = this.createDirectoryToolset();
    this.directoryMenu = new Menu([this.directoryToolset]);
  }

  getDirectoryMenu(): Menu { return this.directoryMenu; }
  getDirectoryToolset(): Toolset { return this.directoryToolset; }

  // Persist chat messages (called by rooms)
  onChatMessage(room: string, entry: { timestamp: number; agentId: string; handle: string; content: string }) {
    try {
      this.db?.insertChatMessage({
        timestamp: entry.timestamp,
        room,
        agentId: entry.agentId,
        handle: entry.handle,
        content: entry.content
      });
    } catch {}
  }

  // Read recent chat for a room from DB. If selfAgentId is provided, own messages are labeled as "You".
  getRecentChatText(room: string, limit: number = 20, selfAgentId?: string): string {
    try {
      const max = Math.min(20, Math.max(0, Number(limit) || 0));
      const rows = this.db?.listRecentChatByRoom(room, max) ?? [];
      if (!rows.length) return "No messages";
      return rows
        .map(m => {
          const ts = new Date(m.timestamp).toISOString();
          const who = selfAgentId && String(m.agentId) === String(selfAgentId)
            ? "You"
            : `${m.handle} (#${m.agentId})`;
          return `[${ts}] ${who}: ${m.content}`;
        })
        .join("\n");
    } catch {
      return "(chat unavailable)";
    }
  }

  listRooms(): string[] { return Array.from(this.rooms.keys()); }

  listRoomSnapshots(limitMessages: number = 8) {
    return Array.from(this.rooms.values()).map(r => r.getSnapshot(limitMessages));
  }

  getOrCreateRoom(name: string, isPrivate: boolean = false): Room {
    if (!this.rooms.has(name)) {
      this.rooms.set(name, new Room(this, name, isPrivate));
    }
    return this.rooms.get(name)!;
  }

  getRoom(name: string): Room | undefined { return this.rooms.get(name); }

  private createDirectoryToolset(): Toolset {
    const tools: ToolSchema[] = [
      { name: "listRooms", description: "List available rooms", parameters: [] },
      { name: "createRoom", description: "Create a room", parameters: [
        { name: "name", description: "Room name", type: "string", enum: [], default: "" },
        { name: "visibility", description: "public or private", type: "string", enum: ["public","private"], default: "public" }
      ]},
      { name: "createPrivateRoomAndInvite", description: "Create a private room and invite an agent", parameters: [
        { name: "name", description: "Room name", type: "string", enum: [], default: "" },
        { name: "inviteAgentId", description: "Agent id to invite", type: "string", enum: [], default: "" }
      ]},
      { name: "joinRoom", description: "Join a room by name", parameters: [
        { name: "name", description: "Room name", type: "string", enum: [], default: "" }
      ]},
      { name: "acceptInvite", description: "Accept an invite to a private room", parameters: [
        { name: "name", description: "Room name", type: "string", enum: [], default: "" }
      ]}
    ];

    const callback = (agent: Agent | undefined, toolcall: ToolCall): string => {
      if (!agent) return "Error: agent required";
      switch (toolcall.name) {
        case "listRooms":
          if (this.rooms.size === 0) return "No rooms";
          return Array.from(this.rooms.values()).map(r => `${r.name} (${r.isPrivate ? "private" : "public"})`).join("\n");
        case "createRoom": {
          const { name, visibility } = toolcall.parameters as any;
          if (!name) return "Error: name required";
          const room = this.getOrCreateRoom(String(name), String(visibility ?? 'public') === 'private');
          return `Created room ${room.name} (${room.isPrivate ? 'private' : 'public'})`;
        }
        case "createPrivateRoomAndInvite": {
          const { name, inviteAgentId } = toolcall.parameters as any;
          if (!name || !inviteAgentId) return "Error: name and inviteAgentId required";
          const room = this.getOrCreateRoom(String(name), true);
          room.invites.add(String(inviteAgentId));
          return `Created private room ${room.name} and invited #${inviteAgentId}`;
        }
        case "joinRoom": {
          const { name } = toolcall.parameters as any;
          const room = this.getRoom(String(name));
          if (!room) return `Error: room ${name} not found`;
          if (room.isPrivate && !room.invites.has(agent.getId())) {
            return `Error: room ${room.name} is private; invite required`;
          }
          agent.setMenu(room.menu);
          return `Joined room ${room.name}`;
        }
        case "acceptInvite": {
          const { name } = toolcall.parameters as any;
          const room = this.getRoom(String(name));
          if (!room) return `Error: room ${name} not found`;
          if (!room.invites.has(agent.getId())) return `Error: no invite for you in ${room.name}`;
          agent.setMenu(room.menu);
          return `Accepted invite and joined ${room.name}`;
        }
        default:
          return `Unknown tool: ${toolcall.name}`;
      }
    };

    return new Toolset("Polis Directory", tools, { toolsetName: "Polis Directory", callback });
  }
}
