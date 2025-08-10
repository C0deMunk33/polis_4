import { Toolset, ToolCall, ToolSchema, ParameterSchema } from "../toolset";

export function createIdentityToolset(name: string = "Identity"): Toolset {
  const tools: ToolSchema[] = [
    {
      name: "getHandle",
      description: "Get current handle",
      parameters: []
    },
    {
      name: "setHandle",
      description: "Set a new handle for yourself (does not auto-enter chat)",
      parameters: [
        { name: "handle", description: "New handle", type: "string", enum: [], default: "" }
      ]
    },
    {
      name: "getSelf",
      description: "Get the agent's self state (includes handle and all self fields)",
      parameters: []
    },
    {
      name: "setSelfField",
      description: "Set a key/value in the agent's self state",
      parameters: [
        { name: "key", description: "Field name", type: "string", enum: [], default: "" },
        { name: "value", description: "Field value", type: "string", enum: [], default: "" }
      ]
    }
  ];

  const callback = (agent: any | undefined, toolcall: ToolCall): string => {
    if (!agent) return "Error: agent required";
    switch (toolcall.name) {
      case "getHandle":
        return `Handle: ${agent.getHandle?.() ?? "(unset)"}`;
      case "setHandle": {
        const handle = (toolcall.parameters as any).handle;
        if (!handle) return "Error: handle is required";
        const out = agent.setHandle?.(handle);
        return String(out ?? `Handle set to ${handle}`);
      }
      case "getSelf": {
        const self = agent.getSelf?.() ?? {};
        const handle = agent.getHandle?.();
        const enriched = { handle: handle ?? "(unset)", ...self };
        return JSON.stringify(enriched, null, 2);
      }
      case "setSelfField": {
        const { key, value } = toolcall.parameters as any;
        if (!key) return "Error: key is required";
        agent.setSelfField?.(String(key), String(value ?? ""));
        return `Self[${key}] set`;
      }
      default:
        return `Unknown tool: ${toolcall.name}`;
    }
  };

  return new Toolset(name, tools, { toolsetName: name, callback });
}
