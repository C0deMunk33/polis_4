import { Toolset, ToolCall, ParameterSchema } from "./toolset";
import { Item, ItemInteractionRequest, InteractionDefinition } from "./items";

// Define the ToolSchema interface locally since it's not exported from toolset.ts
interface ToolSchema {
    name: string;
    description: string;
    parameters: ParameterSchema[];
}

export class ItemToolsetAdapter {
    /**
     * Converts an item into a self-contained toolset
     * Each interaction becomes a tool, and reset is included as a tool
     */
    static createToolsetFromItem(item: Item, toolsetName?: string): Toolset {
        const name = toolsetName || item.template.name;
        
        // Create tools from interactions
        const interactionTools: ToolSchema[] = item.template.interactions.map(interaction => {
            return {
                name: interaction.name,
                description: interaction.description,
                parameters: interaction.action_inputs.map(input => ({
                    name: input.name_and_amount,
                    description: `Input: ${input.name_and_amount} (${input.type})`,
                    type: "string",
                    enum: [],
                    default: ""
                }))
            };
        });

        // Add reset tool
        const resetTool: ToolSchema = {
            name: "reset",
            description: "Reset this item to its initial state",
            parameters: []
        };

        const tools: ToolSchema[] = [...interactionTools, resetTool];

        const toolsetCallback = (_agent: any | undefined, toolcall: ToolCall): string => {
            try {
                if (toolcall.name === "reset") {
                    // Handle reset
                    item.reset().then(newState => {
                        console.log(`Item ${item.template.name} reset to initial state: ${JSON.stringify(newState, null, 2)}`);
                    }).catch(error => {
                        console.error(`Error resetting item: ${error}`);
                    });
                    
                    return `Resetting ${item.template.name} to initial state`;
                }

                // Handle interactions
                const interaction = item.template.interactions.find(i => i.name === toolcall.name);
                if (!interaction) {
                    return "Interaction not found";
                }

                const interactionRequest: ItemInteractionRequest = {
                    interaction: toolcall.name,
                    inputs: toolcall.parameters,
                    intent: `User wants to ${toolcall.name}`
                };

                // Note: This is a synchronous wrapper around an async operation
                item.interact(interactionRequest).then(result => {
                    console.log(`Item: ${item.template.name}`);
                    console.log(`Interaction: ${result.description}`);
                    if (result.outputs.length > 0) {
                        console.log(`Outputs:`);
                        result.outputs.forEach(output => {
                            console.log(`  - ${output.name_and_amount} (${output.type})`);
                        });
                    }
                }).catch(error => {
                    console.error(`Error performing interaction: ${error}`);
                });
                
                return `Executing ${toolcall.name} on ${item.template.name}`;
            } catch (error) {
                return `Error preparing operation: ${error}`;
            }
        };

        return new Toolset(name, tools, { toolsetName: name, callback: toolsetCallback });
    }

    /**
     * Creates a collection toolset for managing multiple items
     * This provides utilities to work with a collection of items
     */
    static createItemCollectionToolset(items: Item[], toolsetName: string = "Item Collection"): Toolset {
        const tools: ToolSchema[] = [
            {
                name: "listItems",
                description: "List all available items and their current state",
                parameters: []
            },
            {
                name: "getItemMenu",
                description: "Get the detailed menu for a specific item",
                parameters: [
                    {
                        name: "itemIndex",
                        description: "Index of the item to get menu for",
                        type: "number",
                        enum: [],
                        default: ""
                    }
                ]
            },
            {
                name: "interactWithItem",
                description: "Perform an interaction with a specific item",
                parameters: [
                    {
                        name: "itemIndex",
                        description: "Index of the item to interact with",
                        type: "number",
                        enum: [],
                        default: ""
                    },
                    {
                        name: "interaction",
                        description: "Name of the interaction to perform",
                        type: "string",
                        enum: [],
                        default: ""
                    },
                    {
                        name: "inputs",
                        description: "JSON string of inputs for the interaction",
                        type: "string",
                        enum: [],
                        default: "{}"
                    }
                ]
            }
        ];

        const toolsetCallback = (toolcall: ToolCall): string => {
            try {
                switch (toolcall.name) {
                    case "listItems":
                        let response = "Available Items:\n";
                        items.forEach((item, index) => {
                            response += `[${index}] ${item.template.name}\n`;
                            response += `  Description: ${item.template.description}\n`;
                            response += `  State: ${JSON.stringify(item.instance.item_state, null, 2)}\n`;
                            response += `  Interactions: ${item.template.interactions.map(i => i.name).join(", ")}\n\n`;
                        });
                        return response;
                    
                    case "getItemMenu":
                        const itemIndex = toolcall.parameters.itemIndex;
                        const item = items[itemIndex];
                        
                        if (!item) {
                            return `Error: Item at index ${itemIndex} not found`;
                        }

                        // Note: This is a synchronous wrapper around an async operation
                        item.getMenu().then(menu => {
                            console.log(menu);
                        }).catch(error => {
                            console.error(`Error getting item menu: ${error}`);
                        });
                        
                        return `Getting menu for item at index ${itemIndex}`;
                    
                    case "interactWithItem":
                        const interactItemIndex = toolcall.parameters.itemIndex;
                        const interactItem = items[interactItemIndex];
                        const interactionName = toolcall.parameters.interaction;
                        const inputsStr = toolcall.parameters.inputs;
                        
                        if (!interactItem) {
                            return `Error: Item at index ${interactItemIndex} not found`;
                        }

                        const interaction = interactItem.template.interactions.find(i => i.name === interactionName);
                        if (!interaction) {
                            return `Error: Interaction ${interactionName} not found on item ${interactItem.template.name}`;
                        }

                        let inputs = {};
                        try {
                            inputs = JSON.parse(inputsStr);
                        } catch (error) {
                            return `Error: Invalid JSON in inputs parameter`;
                        }

                        const interactionRequest: ItemInteractionRequest = {
                            interaction: interactionName,
                            inputs: inputs,
                            intent: `User wants to ${interactionName} on ${interactItem.template.name}`
                        };

                        // Note: This is a synchronous wrapper around an async operation
                        interactItem.interact(interactionRequest).then(result => {
                            console.log(`Item: ${interactItem.template.name}`);
                            console.log(`Interaction: ${result.description}`);
                            if (result.outputs.length > 0) {
                                console.log(`Outputs:`);
                                result.outputs.forEach(output => {
                                    console.log(`  - ${output.name_and_amount} (${output.type})`);
                                });
                            }
                        }).catch(error => {
                            console.error(`Error performing interaction: ${error}`);
                        });
                        
                        return `Executing ${interactionName} on ${interactItem.template.name}`;
                    
                    default:
                        return `Unknown tool: ${toolcall.name}`;
                }
            } catch (error) {
                return `Error executing tool: ${error}`;
            }
        };

        return new Toolset(toolsetName, tools, toolsetCallback);
    }

    /**
     * Creates individual toolsets from a collection of items
     * Each item becomes its own self-contained toolset
     */
    static createIndividualToolsets(items: Item[]): Toolset[] {
        return items.map(item => this.createToolsetFromItem(item));
    }

    /**
     * @deprecated Use createItemCollectionToolset instead
     * Creates a toolset that contains multiple items as separate tools
     */
    static createToolsetFromItems(items: Item[], toolsetName: string): Toolset {
        const tools: ToolSchema[] = [];

        items.forEach((item, index) => {
            // Add a tool for each interaction of each item
            item.template.interactions.forEach(interaction => {
                const toolName = `${item.template.name}_${interaction.name}`;
                
                tools.push({
                    name: toolName,
                    description: `${interaction.description} (Item: ${item.template.name})`,
                    parameters: [
                        {
                            name: "itemIndex",
                            description: `Index of the item (${index})`,
                            type: "number",
                            enum: [],
                            default: ""
                        },
                        ...interaction.action_inputs.map(input => ({
                            name: input.name_and_amount,
                            description: `Input: ${input.name_and_amount} (${input.type})`,
                            type: "string",
                            enum: [],
                            default: ""
                        }))
                    ]
                });
            });
        });

        const toolsetCallback = (_agent: any | undefined, toolcall: ToolCall): string => {
            try {
                const [itemName, interactionName] = toolcall.name.split('_');
                const itemIndex = toolcall.parameters.itemIndex;
                const targetItem = items[itemIndex];
                
                if (!targetItem) {
                    return `Error: Item at index ${itemIndex} not found`;
                }

                const interaction = targetItem.template.interactions.find(i => i.name === interactionName);
                if (!interaction) {
                    return `Error: Interaction ${interactionName} not found on item ${targetItem.template.name}`;
                }

                // Remove itemIndex from params for the interaction
                const { itemIndex: _, ...interactionParams } = toolcall.parameters;

                const interactionRequest: ItemInteractionRequest = {
                    interaction: interactionName,
                    inputs: interactionParams,
                    intent: `User wants to ${interactionName} on ${targetItem.template.name}`
                };

                // Note: This is a synchronous wrapper around an async operation
                targetItem.interact(interactionRequest).then(result => {
                    console.log(`Item: ${targetItem.template.name}`);
                    console.log(`Interaction: ${result.description}`);
                    if (result.outputs.length > 0) {
                        console.log(`Outputs:`);
                        result.outputs.forEach(output => {
                            console.log(`  - ${output.name_and_amount} (${output.type})`);
                        });
                    }
                }).catch(error => {
                    console.error(`Error performing interaction: ${error}`);
                });
                
                return `Executing ${interactionName} on ${targetItem.template.name}`;
            } catch (error) {
                return `Error preparing interaction: ${error}`;
            }
        };

        return new Toolset(toolsetName, tools, { toolsetName, callback: toolsetCallback });
    }

    /**
     * Creates a toolset with item management tools
     */
    static createItemManagementToolset(items: Item[], toolsetName: string = "Item Management"): Toolset {
        const tools: ToolSchema[] = [
            {
                name: "listItems",
                description: "List all available items and their current state",
                parameters: []
            },
            {
                name: "getItemMenu",
                description: "Get the detailed menu for a specific item",
                parameters: [
                    {
                        name: "itemIndex",
                        description: "Index of the item to get menu for",
                        type: "number",
                        enum: [],
                        default: ""
                    }
                ]
            },
            {
                name: "resetItem",
                description: "Reset an item to its initial state",
                parameters: [
                    {
                        name: "itemIndex",
                        description: "Index of the item to reset",
                        type: "number",
                        enum: [],
                        default: ""
                    }
                ]
            }
        ];

        const toolsetCallback = (_agent: any | undefined, toolcall: ToolCall): string => {
            try {
                switch (toolcall.name) {
                    case "listItems":
                        let response = "Available Items:\n";
                        items.forEach((item, index) => {
                            response += `[${index}] ${item.template.name}\n`;
                            response += `  Description: ${item.template.description}\n`;
                            response += `  State: ${JSON.stringify(item.instance.item_state, null, 2)}\n`;
                            response += `  Interactions: ${item.template.interactions.map(i => i.name).join(", ")}\n\n`;
                        });
                        return response;
                    
                    case "getItemMenu":
                        const itemIndex = toolcall.parameters.itemIndex;
                        const item = items[itemIndex];
                        
                        if (!item) {
                            return `Error: Item at index ${itemIndex} not found`;
                        }

                        // Note: This is a synchronous wrapper around an async operation
                        item.getMenu().then(menu => {
                            console.log(menu);
                        }).catch(error => {
                            console.error(`Error getting item menu: ${error}`);
                        });
                        
                        return `Getting menu for item at index ${itemIndex}`;
                    
                    case "resetItem":
                        const resetItemIndex = toolcall.parameters.itemIndex;
                        const resetItem = items[resetItemIndex];
                        
                        if (!resetItem) {
                            return `Error: Item at index ${resetItemIndex} not found`;
                        }

                        // Note: This is a synchronous wrapper around an async operation
                        resetItem.reset().then(newState => {
                            console.log(`Item ${resetItem.template.name} reset to initial state: ${JSON.stringify(newState, null, 2)}`);
                        }).catch(error => {
                            console.error(`Error resetting item: ${error}`);
                        });
                        
                        return `Resetting item at index ${resetItemIndex}`;
                    
                    default:
                        return `Unknown tool: ${toolcall.name}`;
                }
            } catch (error) {
                return `Error executing tool: ${error}`;
            }
        };

        return new Toolset(toolsetName, tools, { toolsetName, callback: toolsetCallback });
    }
} 