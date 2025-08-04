import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema'
import { getStructuredOutput } from "./venice-client";
import { Menu } from './menu';
import { ToolCall } from 'openai/resources/beta/threads/runs/steps';
import { ToolsetCallback } from './toolset';

const AgentPassSchema = z.object({
    intent: z.string(),
    toolCalls: z.array(z.object({
        name: z.string(),
        parameters: z.record(z.any()),
    })),
    followupInstructions: z.string(),
})

type AgentPass = z.infer<typeof AgentPassSchema>;

export class Agent {
    private model: string;
    private systemPrompt: string;
    private menu: Menu;
    private prePassToolCalls: ToolCall[];
    private postPassToolCalls: ToolCall[];
    private toolsetCallbacks: ToolsetCallback[];

    constructor(model: string, systemPrompt: string, menu: Menu, prePassToolCalls: ToolCall[], postPassToolCalls: ToolCall[], toolsetCallbacks: ToolsetCallback[]) {
        this.model = model;
        this.systemPrompt = systemPrompt;
        this.menu = menu;
        this.prePassToolCalls = prePassToolCalls;
        this.postPassToolCalls = postPassToolCalls;
        this.toolsetCallbacks = toolsetCallbacks;
    }

    async prePass(userPrompt: string) {
        // run each toolset callback in order
        // package for llm context

    }

    async doPass(userPrompt: string) {
        // pass context to llm
        // get structured output
        // return structured output
        // add to context
    }

    async postPass(userPrompt: string) {
        // run each toolset callback in order
        // package for llm context
        // release for next pass

    }
}