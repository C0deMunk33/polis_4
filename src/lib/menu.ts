import { ToolCall, Toolset } from "./toolset";
import type { Agent } from "./agent";

export class Menu {
    toolsets: Toolset[] = [];
    currentToolset: string | undefined;

    constructor(toolsets: Toolset[]) {
        this.toolsets = toolsets;
    }

    addToolset(toolset: Toolset) {
        this.toolsets.push(toolset);
    }

    getMenu() : string {
        let resultString = ""
        if (this.currentToolset) {
            // show list of tools and toolList function
            resultString += `\nTool Menu (${this.currentToolset}):\n`;
            for (const tool of this.toolsets.find((toolset) => toolset.name === this.currentToolset)?.getTools() ?? []) {
                resultString += `\t${tool.name} (${tool.parameters.map((param) => param.name).join(", ") }): ${tool.description}\n`;
            }
            resultString += "To return to the toolset menu, use toolList()\n";
        } else {
            // show list of toolsets and loadToolset function
            resultString += "Tool Sets Available:\n";
            for (let i = 0; i < this.toolsets.length; i++) {
                resultString += `\t[${i}] ${this.toolsets[i].name}\n`;
            }
            resultString += "\n To load a toolset, use loadToolset(toolsetIndex)\n";
        }
        return resultString;
    }

    parseToolCall(toolcall: ToolCall) : string {
        if (this.currentToolset) {
            if (toolcall.name === "toolList") {
                this.currentToolset = undefined;
                return "Toolset menu loaded";
            }
            const tool = this.toolsets.find((toolset) => toolset.name === this.currentToolset)?.getTools().find((tool) => tool.name === toolcall.name);
            if (tool) {
                return this.callTool(toolcall);
            } else {
                return "Tool not found";
            }
        } else {
            if (toolcall.name === "loadToolset") {
                this.currentToolset = this.toolsets[toolcall.parameters.toolsetIndex].name;
                return "Toolset menu loaded";
            } else {
                return "No toolset loaded";
            }   
        }
    }

    callTool(toolcall: ToolCall) : string;
    callTool(agent: Agent, toolcall: ToolCall) : string;
    callTool(arg1: Agent | ToolCall, arg2?: ToolCall) : string {
        if (arg2) {
            const agent = arg1 as Agent;
            const toolcall = arg2;
            return this.toolsets.find((toolset) => toolset.getTools().some((tool) => tool.name === toolcall.name))?.callTool(agent, toolcall) ?? "";
        }
        const toolcall = arg1 as ToolCall;
        return this.toolsets.find((toolset) => toolset.getTools().some((tool) => tool.name === toolcall.name))?.callTool(toolcall) ?? "";
    }

    loadToolset(name: string) : Toolset | undefined {
        return this.toolsets.find((toolset) => toolset.name === name);
    }

    unloadToolset(name: string) {
        this.toolsets = this.toolsets.filter((toolset) => toolset.name !== name);
    }
}