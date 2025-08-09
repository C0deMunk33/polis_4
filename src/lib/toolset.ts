import type { Agent } from './agent';

export interface ParameterSchema {
    name: string;
    description: string;
    type: string;
    enum: string[];
    default: string;
}

export interface ToolSchema {
    name: string;
    description: string;
    parameters: ParameterSchema[];
}

export interface ToolCall {
    name: string;
    parameters: Record<string, any>;
}

export interface ToolsetCallback {
    toolsetName: string;
    callback: (agent: Agent | undefined, toolcall: ToolCall) => string;
}

export class Toolset {
    name: string;
    tools: ToolSchema[] = [];
    toolsetCallback: ToolsetCallback;

    constructor(name: string, tools: ToolSchema[], toolsetCallback: ToolsetCallback | ((toolcall: ToolCall) => string)) {
        this.name = name;
        this.tools = tools;
        if (typeof toolsetCallback === 'function') {
            this.toolsetCallback = {
                toolsetName: name,
                callback: (_agent: Agent | undefined, toolcall: ToolCall) => toolsetCallback(toolcall)
            };
        } else {
            this.toolsetCallback = toolsetCallback;
        }
    }

    getTools() : ToolSchema[] {
        return this.tools;
    }

    callTool(toolcall: ToolCall) : string;
    callTool(agent: Agent, toolcall: ToolCall) : string;
    callTool(arg1: Agent | ToolCall, arg2?: ToolCall) : string {
        if (arg2) {
            return this.toolsetCallback.callback(arg1 as Agent, arg2);
        }
        return this.toolsetCallback.callback(undefined, arg1 as ToolCall);
    }
}