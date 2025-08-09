import { Toolset, ToolCall, ParameterSchema } from "../toolset";

// Define ToolSchema locally since it's not exported from toolset.ts
interface ToolSchema {
  name: string;
  description: string;
  parameters: ParameterSchema[];
}

interface ChatMessage {
  timestamp: number;
  agentId: string;
  handle: string;
  content: string;
}

interface ParticipantInfo {
  handle: string;
  joinedAt: number;
}

/**
 * Self-contained multi-agent chat toolset with registry.
 * Tools:
 * - enter: Register/enter the chat with handle (agent id is inferred)
 * - leave: Leave the chat
 * - who: List currently present agents
 * - chat: Post a message (caller only)
 * - read: Read recent messages (caller only)
 */
export function createChatToolset(toolsetName: string = "Chat"): Toolset {
  const messages: ChatMessage[] = [];
  const participants: Map<string, ParticipantInfo> = new Map();

  const tools: ToolSchema[] = [
    {
      name: "enter",
      description: "Enter the chat by registering your handle",
      parameters: [
        {
          name: "handle",
          description: "Handle to use in chat",
          type: "string",
          enum: [],
          default: ""
        }
      ]
    },
    {
      name: "leave",
      description: "Leave the chat",
      parameters: []
    },
    {
      name: "who",
      description: "List agents currently in the chat",
      parameters: []
    },
    {
      name: "chat",
      description: "Post a message to the shared chat (as yourself)",
      parameters: [
        {
          name: "content",
          description: "Message content",
          type: "string",
          enum: [],
          default: ""
        }
      ]
    },
    {
      name: "read",
      description: "Read the most recent messages (must have entered)",
      parameters: [
        {
          name: "limit",
          description: "Maximum number of recent messages to return (default 10)",
          type: "number",
          enum: [],
          default: "10"
        }
      ]
    }
  ];

  const toolsetCallback = (agent: any | undefined, toolcall: ToolCall): string => {
    try {
      const normalize = (id?: string): string | undefined => {
        if (!id) return undefined;
        return id.startsWith('#') ? id.slice(1) : id;
      };
      const inferAgentId = (): string | undefined => {
        try {
          return agent?.getId?.();
        } catch {
          return undefined;
        }
      };

      switch (toolcall.name) {
        case "enter": {
          const { handle } = toolcall.parameters as Record<string, string>;
          const agentId = normalize(inferAgentId());
          if (!agentId || !handle) {
            return "Error: agent is required and 'handle' is required";
          }
          const now = Date.now();
          const existed = participants.has(agentId);
          participants.set(agentId, { handle: String(handle), joinedAt: existed ? (participants.get(agentId)!.joinedAt) : now });
          const action = existed ? "updated handle in" : "entered";
          return `Agent ${handle} (#${agentId}) ${action} chat`;
        }
        case "leave": {
          const callerId = normalize(inferAgentId());
          if (!callerId) {
            return "Error: agent is required";
          }
          const info = participants.get(callerId);
          if (!info) {
            return `Error: Agent #${callerId} is not in chat`;
          }
          participants.delete(callerId);
          return `Agent ${info.handle} (#${callerId}) left chat`;
        }
        case "who": {
          if (participants.size === 0) {
            return "No agents in chat";
          }
          const lines = Array.from(participants.entries()).map(([id, info]) => {
            const ts = new Date(info.joinedAt).toISOString();
            return `${info.handle} (#${id}) since ${ts}`;
          });
          return lines.join("\n");
        }
        case "chat": {
          const { content } = toolcall.parameters as Record<string, string>;
          const callerId = normalize(inferAgentId());
          if (!callerId) {
            return "Error: agent is required";
          }
          const info = participants.get(callerId);
          if (!info) {
            return `Error: Agent #${callerId} must enter before chatting`;
          }
          if (!content || typeof content !== "string") {
            return "Error: 'content' must be a non-empty string";
          }
          const entry: ChatMessage = {
            timestamp: Date.now(),
            agentId: String(callerId),
            handle: info.handle,
            content: String(content)
          };
          messages.push(entry);
          return `Message posted by ${entry.handle} (#${entry.agentId})`;
        }
        case "read": {
          const callerId = normalize(inferAgentId());
          if (!callerId) {
            return "Error: agent is required";
          }
          const info = participants.get(callerId);
          if (!info) {
            return `Error: Agent #${callerId} must enter before reading`;
          }
          const limit = (toolcall.parameters as Record<string, any>).limit;
          const max = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : 10;
          const slice = messages.slice(-max);
          if (slice.length === 0) {
            return "No messages";
          }
          const lines = slice.map(m => {
            const ts = new Date(m.timestamp).toISOString();
            return `[${ts}] ${m.handle} (#${m.agentId}): ${m.content}`;
          });
          return lines.join("\n");
        }
        default:
          return `Unknown tool: ${toolcall.name}`;
      }
    } catch (error) {
      return `Error executing tool: ${error}`;
    }
  };

  const ts = new Toolset(toolsetName, tools, { toolsetName, callback: toolsetCallback });
  (ts as any).getRecentMessages = (limit: number = 10) => {
    const slice = messages.slice(-Math.max(0, Number(limit) || 0));
    return slice.map(m => ({ timestamp: m.timestamp, agentId: m.agentId, handle: m.handle, content: m.content }));
  };
  (ts as any).getParticipants = () => {
    return Array.from(participants.entries()).map(([agentId, info]) => ({ agentId, handle: info.handle, joinedAt: info.joinedAt }));
  };
  return ts;
}
