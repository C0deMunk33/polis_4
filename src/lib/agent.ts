import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema'
import { getStructuredOutput } from "./venice-client";
import { Menu } from './menu';
import { ToolsetCallback, ToolCall } from './toolset';

const AgentPassSchema = z.object({
    intent: z.string(),
    agentThoughts: z.string().describe("A brief chain-of-thought style rationale for the chosen intent and tools"),
    toolCalls: z.array(z.object({
        name: z.string(),
        parameters: z.record(z.any()),
    })),
    followupInstructions: z.string(),
})

type AgentPass = z.infer<typeof AgentPassSchema>;

export class Agent {
    private id: string;
    private model: string;
    private systemPrompt: string;
    private menu: Menu;
    private toolsetCallbacks: ToolsetCallback[];

    private lastMessageBuffer: { system: string; messages: { role: 'user' | 'assistant'; content: string }[] } | null = null;

    private historySummaries: string[] = [];
    private readonly maxHistorySummaries: number = 12;
    private readonly recentToolCallWindow: number = 5;
    private handleValue: string | undefined;
    private selfState: Record<string, string> = {};

    constructor(id: string, model: string, systemPrompt: string, menu: Menu, toolsetCallbacks: ToolsetCallback[] = []) {
        this.id = id;
        this.model = model;
        this.systemPrompt = systemPrompt;
        this.menu = menu;
        this.toolsetCallbacks = toolsetCallbacks;
    }

    getId(): string {
        return this.id;
    }

    getHandle(): string | undefined {
        return this.handleValue;
    }

    setHandle(newHandle: string): string {
        this.handleValue = newHandle;
        return `Handle set locally to ${newHandle}`;
    }

    getSelf(): Record<string, string> {
        return { ...this.selfState };
    }

    setSelfField(key: string, value: string): void {
        this.selfState[key] = value;
    }

    setSelf(newSelf: Record<string, string>): void {
        this.selfState = { ...newSelf };
    }

    setMenu(newMenu: Menu): void {
        this.menu = newMenu;
    }

    getMenuInstance(): Menu {
        return this.menu;
    }

    getLastMessageBuffer(): { system: string; messages: { role: 'user' | 'assistant'; content: string }[] } | null {
        return this.lastMessageBuffer;
    }

    private buildToolCatalog(): string {
        const lines: string[] = [];
        for (const toolset of this.menu.toolsets) {
            for (const tool of toolset.getTools()) {
                const exampleParams: Record<string, any> = {};
                for (const p of tool.parameters) {
                    if (p.type === 'number') {
                        exampleParams[p.name] = Number.isFinite(Number(p.default)) ? Number(p.default) : 0;
                    } else if (p.type === 'string') {
                        exampleParams[p.name] = typeof p.default === 'string' ? p.default : '';
                    } else {
                        exampleParams[p.name] = p.default ?? '';
                    }
                }
                lines.push(JSON.stringify({ name: tool.name, parameters: exampleParams }));
            }
        }
        return lines.join('\n');
    }

    private buildMessageBuffer(menuText: string | undefined, preResults: string, selfInstructions: string): { system: string; messages: { role: 'user' | 'assistant'; content: string }[] } {
        // Build system prompt with general guidance
        const systemSegments: string[] = [];
        const catalog = this.buildToolCatalog();
        if (catalog.trim().length > 0) {
            systemSegments.push(`[Tool Catalog]\nEach line is a valid tool call example as JSON:\n${catalog}`);
        }
        const outputSchema = zodToJsonSchema(AgentPassSchema, 'AgentPass');
        systemSegments.push(`[Output Schema]\nPlease reply in the following format (strict JSON matching this schema):\n${JSON.stringify(outputSchema, null, 2)}`);
        // Menu will be moved to an assistant message just before the user message
        if (this.historySummaries.length > 0) {
            const trimmed = this.historySummaries.slice(-this.maxHistorySummaries);
            const recent = trimmed.slice(-this.recentToolCallWindow).join(' | ');
            if (/No messages/i.test(preResults) || /chat\.read/i.test(recent)) {
                systemSegments.push(`[Anti-Loop Hint]\nAvoid repeating chat.read when there are no new messages. Try: chat.speak, explore items (listItems/myItems), createItem, or change rooms.`);
            }
        }
        const system = [this.systemPrompt, ...systemSegments].filter(Boolean).join('\n\n');

        const messages: { role: 'user' | 'assistant'; content: string }[] = [];

        // Move pass history into an assistant message
        if (this.historySummaries.length > 0) {
            const trimmed = this.historySummaries.slice(-this.maxHistorySummaries);
            messages.push({ role: 'assistant', content: `[Pass History]\n${trimmed.join('\n')}` });
        }

        // Primary user instruction will be appended last
        const userSegments: string[] = [];
        if (selfInstructions.trim().length > 0) {
            userSegments.push(`[Self Instructions]\n${selfInstructions.trim()}`);
        }
        // Break out tool results as individual assistant messages
        if (preResults && preResults.trim().length > 0) {
            const text = preResults.trim();
            const sections: Array<{ name: string; content: string }> = [];
            const regex = /\-\s+([^:]+):\s*\n?([\s\S]*?)(?=\n\-\s+[^:]+:|$)/g;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(text)) !== null) {
                const name = String(match[1] || '').trim();
                const content = String(match[2] || '').trim();
                if (name) sections.push({ name, content });
            }
            if (sections.length === 0) {
                // Fallback: send as a single assistant message
                messages.push({ role: 'assistant', content: `[Pre-Pass Results]\n${text}` });
            } else {
                for (const sec of sections) {
                    const header = `[Tool Result] ${sec.name}`;
                    const body = sec.content || '(none)';
                    messages.push({ role: 'assistant', content: `${header}\n${body}` });
                }
            }
        }

        // Add menu snapshot as the last assistant message before the user prompt
        if (menuText && menuText.trim().length > 0) {
            messages.push({ role: 'assistant', content: `[Menu]\n${menuText.trim()}` });
        }

        // Append the user instruction as the final message
        if (userSegments.length > 0) {
            messages.push({ role: 'user', content: userSegments.join('\n\n') });
        }

        return { system, messages };
    }

    async doPass(selfInstructions: string, preResults: string = ""): Promise<AgentPass> {
        const menuText = this.menu.getMenu();
        const { system, messages } = this.buildMessageBuffer(menuText, preResults, selfInstructions);
        this.lastMessageBuffer = { system, messages };
        const response = await getStructuredOutput(system, messages, this.model, AgentPassSchema);
        if (!response) {
            throw new Error('No response from model');
        }
        const parsed = AgentPassSchema.parse(JSON.parse(response));

        const fu = (parsed.followupInstructions || '').trim();
        const noneLike = /^(none|n\/a|no(ne)?\.?|na)$/i;
        if (fu.length === 0 || noneLike.test(fu)) {
            parsed.followupInstructions = 'Propose a concrete next action that builds on current results and uses available tools to evolve objectives.';
        }

        const summary = `Intent: ${parsed.intent}; Thoughts: ${parsed.agentThoughts?.slice(0, 80) ?? ''}; Tools: ${parsed.toolCalls.map(tc => tc.name).join(', ')}; Next: ${parsed.followupInstructions.substring(0, 120)}...`;
        this.historySummaries.push(summary);
        if (this.historySummaries.length > this.maxHistorySummaries) {
            this.historySummaries.splice(0, this.historySummaries.length - this.maxHistorySummaries);
        }

        return parsed;
    }

    async postPass(result: any, extraPostToolCalls: ToolCall[] = []): Promise<string[]> {
        const executions: string[] = [];

        for (const tc of result.toolCalls) {
            try {
                if (tc.name === 'enter') {
                    const whoAny = this.menu.callTool(this, { name: 'who', parameters: {} }) as any;
                    const who = typeof (whoAny as any)?.then === 'function' ? await whoAny : whoAny;
                    if (who && who.includes(`(#${this.id})`)) {
                        executions.push(`model:enter -> skipped (already present)`);
                        continue;
                    }
                }

                // Skip consecutive identical tool invocations to reduce loops
                const lastSummary = this.historySummaries[this.historySummaries.length - 1] ?? '';
                const signature = `${tc.name}:${JSON.stringify(tc.parameters || {})}`;
                if (lastSummary.includes(`Tools:`) && lastSummary.includes(tc.name)) {
                    // Lightweight: if last pass used same tool and no new information, consider skipping read-like tools
                    if (/^read$/i.test(tc.name) || /^who$/i.test(tc.name)) {
                        executions.push(`model:${tc.name} -> skipped (avoid consecutive no-op)`);
                        continue;
                    }
                }

                const maybe = this.menu.callTool(this, tc) as any;
                const out = typeof (maybe as any)?.then === 'function' ? await maybe : maybe;
                executions.push(`model:${tc.name} -> ${out}`);
            } catch (err) {
                executions.push(`model:${tc.name} -> Error ${err}`);
            }
        }

        for (const call of extraPostToolCalls) {
            try {
                const maybe = this.menu.callTool(this, call) as any;
                const out = typeof (maybe as any)?.then === 'function' ? await maybe : maybe;
                executions.push(`post:${call.name} -> ${out}`);
            } catch (err) {
                executions.push(`post:${call.name} -> Error ${err}`);
            }
        }

        if (executions.length > 0) {
            this.historySummaries.push(`Post: ${executions.map(s => s.split(' -> ')[0]).join(', ')}`);
        }

        return executions;
    }
}

export type { AgentPass };