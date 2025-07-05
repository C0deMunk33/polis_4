export interface ParameterSchema {
    name: string;
    description: string;
    type: string;
    enum: string[];
    default: string;
}

interface ToolSchema {
    name: string;
    description: string;
    parameters: ParameterSchema[];
}

export interface ToolCall {
    name: string;
    parameters: Record<string, any>;
}

export class Toolset {
    name: string;
    tools: ToolSchema[] = [];
    toolsetCallback: (toolcall: ToolCall) => string;

    constructor(name: string, tools: ToolSchema[], toolsetCallback: (toolcall: ToolCall) => string) {
        this.name = name;
        this.tools = tools;
        this.toolsetCallback = toolsetCallback;
    }

    getTools() : ToolSchema[] {
        return this.tools;
    }

    callTool(toolcall: ToolCall) : string {
        return this.toolsetCallback(toolcall);
    }
}