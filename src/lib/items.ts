import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getStructuredOutput } from "./venice-client";

// Enum equivalent for InteractionIOType
const InteractionIOType = z.enum(["item", "sound", "smell", "status", "feeling", "text", "force"]);

// Schema definitions
const ItemStateSchema = z.object({
  item_state: z.record(z.string(), z.string()).describe("The state of the item")
});

const InteractionIOSchema = z.object({
  name_and_amount: z.string().describe("The name and amount of the input or output"),
  type: InteractionIOType.describe("The type of the input or output, types available are: item, sound, smell, status, feeling, text, force")
});

const InteractionDefinitionSchema = z.object({
  name: z.string().describe("The name of the interaction"),
  description: z.string().describe("A description of the interaction"),
  required_state: z.array(z.string()).describe("The state that is required to perform the interaction"),
  action_inputs: z.array(InteractionIOSchema).describe("The inputs that the interaction requires"),
  action_outputs: z.array(InteractionIOSchema).describe("The outputs that the interaction produces")
});

const InteractionRequestSchema = z.object({
  interaction: z.string().describe("The interaction to perform"),
  inputs: z.record(z.string(), z.string()).describe("The inputs to the interaction. name => amount/details mapping"),
  intent: z.string().describe("The intent of the interaction")
});

const InteractionResponseSchema = z.object({
  updated_item_state: z.record(z.string(), z.string()).describe("The updated state of the item after the interaction"),
  outputs: z.array(InteractionIOSchema).describe("The outputs of the interaction"),
  description: z.string().describe("A description of the interaction")
});

const ItemTemplateSchema = z.object({
  name: z.string().describe("The name of the item"),
  description: z.string().describe("A description of the item"),
  state_parameters: z.array(z.string()).describe("The names of the state parameters that the item needs to function"),
  interactions: z.array(InteractionDefinitionSchema).describe("The interactions that a user of the item can perform with the item"),
  core_prompt: z.string().describe("The core prompt of the item")
});

// Type definitions
export type InteractionIOType = z.infer<typeof InteractionIOType>;
export type ItemState = Record<string, string>;
export type InteractionIO = z.infer<typeof InteractionIOSchema>;
export type InteractionDefinition = z.infer<typeof InteractionDefinitionSchema>;
export type InteractionRequest = z.infer<typeof InteractionRequestSchema>;
export type InteractionResponse = z.infer<typeof InteractionResponseSchema>;
export type ItemTemplate = z.infer<typeof ItemTemplateSchema>;

// In-memory data structures
export interface ItemInstance {
  item_state: Record<string, string>;
}

export interface ItemInteraction {
  updated_item_state: Record<string, string>;
  outputs: InteractionIO[];
  description: string;
}

export interface ItemInteractionRequest {
  interaction: string;
  inputs: Record<string, string>;
  intent: string;
}

// Helper function to get schema description
const getSchemaDescription = (schema: z.ZodType) => {
  const jsonSchema = zodToJsonSchema(schema, "Schema");
  return JSON.stringify(jsonSchema, null, 2);
};

// Prompt generation functions
export const getItemInteractionRequestPrompt = (template: ItemTemplate, state: Record<string, string>, interactionRequest: ItemInteractionRequest) => {
  const prompt = `Your task is to simulate the interaction of an item with a user.

Rules:
    * Do your best to realistically simulate the interaction of the item with the user, based on their request and the current state of the item.
    * Refuse to perform an interaction if the user's request is not possible with the the item.
    * Update the state of the item as necessary.
    * If the user's request is not possible with the current state of the item, you should refuse to perform the interaction and not update the state.
    * Assume any generated output is given to the user, or otherwise removed from the item, so would not remain in the state of this item.

The item is described by the following template:
        ${JSON.stringify(template, null, 2)}

The current state of the item is:
        ${JSON.stringify(state, null, 2)}

The user has the following interaction request:
        ${JSON.stringify(interactionRequest, null, 2)}

Please respond with the interaction response in the following JSON format:
        ${getSchemaDescription(InteractionResponseSchema)}
    `;

  return prompt;
};

export const getGenerateItemTemplateSystemPrompt = () => {
  return `You are a helpful assistant that generates in-game item templates for items where the logic of how the item works is via an LLM.

    Each item has a name, a description, a list of statuses, a core prompt, and a list of actions that users of the item can perform.
    For each action, there is a list of inputs and outputs.
    The inputs and outputs can be any of the following types: item, sound, smell, status, feeling, text, force
    It can be any type of item or device that a player or npc can interact with.
    `;
};

export const getGenerateItemTemplateUserPrompt = (description: string) => {
  return `Generate an item template for the following description:
    ${description}

    Please respond with the template in the following JSON format:
    ${getSchemaDescription(ItemTemplateSchema)}
    `;
};

export const getInitialItemStateUserPrompt = (template: ItemTemplate, creationPrompt: string) => {
  return `Generate the initial state of an item for the following template:
    ${JSON.stringify(template, null, 2)}

    Do not include location or time in the state.

    The item is created with the following prompt:
    ${creationPrompt}
    `;
};

// Main classes
export class ItemInventory {
  private items: Item[] = [];

  async addItem(item: Item) {
    this.items.push(item);
  }

  async removeItem(item: Item) {
    this.items = this.items.filter(i => i !== item);
  }

  async getItem(item: Item) {
    return this.items.find(i => i === item);
  }

  async getItemList(): Promise<string> {
    if (this.items.length === 0) {
      return "  No items currently in room\n";
    }
    let menu = "";
    menu += this.items.map((item, index) => `  [${index}] ${item.template.name} - ${item.template.description}`).join("\n");
    return menu;
  }

  async getItemMenu(index: number): Promise<string> {
    return this.items[index].getMenu();
  }

  async interactWithItem(index: number, interactionRequest: ItemInteractionRequest): Promise<ItemInteraction> {
    return this.items[index].interact(interactionRequest);
  }

  async resetItem(index: number): Promise<ItemState> {
    return this.items[index].reset();
  }
}

export class Item {
  template: ItemTemplate;
  instance: ItemInstance;
  initialState: ItemState;

  private constructor(template: ItemTemplate, instance: ItemInstance) {
    this.template = template;
    this.instance = instance;
    // copy instance state to initial state
    this.initialState = { ...instance.item_state };
  }

  static async create(template: ItemTemplate, creationPrompt: string): Promise<Item> {
    const instance = await ItemsHelpers.createItemInstance(template, creationPrompt);
    return new Item(template, instance);
  }

  async interact(interactionRequest: ItemInteractionRequest): Promise<ItemInteraction> {
    const interaction = await ItemsHelpers.interactWithItem(this.template, this.instance, interactionRequest);

    // update instance state. add or update from the keys
    for (const [key, value] of Object.entries(interaction.updated_item_state)) {
      this.instance.item_state[key] = value;
    }
    return interaction;
  }

  async reset(): Promise<ItemState> {
    this.instance.item_state = { ...this.initialState };
    return this.instance.item_state;
  }

  async getMenu(): Promise<string> {
    return ItemsHelpers.getItemMenu(this.template, this.instance);
  }
}

export class ItemsHelpers {
  static async createTemplate(description: string): Promise<ItemTemplate> {
    const template = await getStructuredOutput(
      getGenerateItemTemplateSystemPrompt(),
      [
        {
          role: "user",
          content: getGenerateItemTemplateUserPrompt(description)
        }
      ],
      //"venice-uncensored",
      "mistral-31-24b",
      ItemTemplateSchema
    );
    if (!template) {
      throw new Error("Failed to create item template");
    }
    let parsedTemplate = JSON.parse(template) as ItemTemplate;
    return parsedTemplate;
  }

  static async createItemInstance(template: ItemTemplate, creationPrompt: string): Promise<ItemInstance> {
    const instance = await getStructuredOutput(
      "You are a helpful assistant that generates the initial state of an item.",
      [
        {
          role: "user",
          content: getInitialItemStateUserPrompt(template, creationPrompt)
        }
      ],
      "venice-uncensored",
      ItemStateSchema
    );
    if (!instance) {
      throw new Error("Failed to create item instance");
    }
    let parsedInstance = JSON.parse(instance) as ItemInstance;
    return parsedInstance;
  }

  static async interactWithItem(template: ItemTemplate, instance: ItemInstance, interactionRequest: ItemInteractionRequest): Promise<ItemInteraction> {
    const interaction = await getStructuredOutput(
      "You are a helpful assistant that generates an interaction with an item.",
      [
        {
          role: "user",
          content: getItemInteractionRequestPrompt(template, instance.item_state, interactionRequest)
        }
      ],
      "venice-uncensored",
      InteractionResponseSchema
    );
    if (!interaction) {
      throw new Error("Failed to create item interaction");
    }
    let parsedInteraction = JSON.parse(interaction) as ItemInteraction;
    return parsedInteraction;
  }

  static async getItemMenu(item: ItemTemplate, instance: ItemInstance): Promise<string> {
    return `# Item: ${item.name}
${item.description}
## Interactions
${item.interactions.map((interaction: InteractionDefinition) => `- ${interaction.name} (${interaction.action_inputs.map((input: InteractionIO) => `${input.name_and_amount}: ${input.type}`).join(", ")}) - ${interaction.description}`).join("\n")}
## State
${Object.entries(instance.item_state).map(([key, value]) => `- ${key}: ${value}`).join("\n")}`;
  }
}