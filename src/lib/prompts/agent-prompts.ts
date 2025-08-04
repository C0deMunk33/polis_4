import { zodToJsonSchema } from "zod-to-json-schema"
import { Menu } from "../menu"
import { z } from "zod"

const agentSystemPrompt = (menu: Menu) => `
You are a helpful assistant that can answer questions and help with tasks.
You have access to a set of tools that you can use to help you answer questions and help with tasks.
You can use the toolList() function to list the tools you have access to.
You can use the loadToolset(toolsetIndex) function to load a toolset.
You can use the unloadToolset(toolsetName) function to unload a toolset.
You can use the callTool(toolName, toolParameters) function to call a tool.
`

const agentUserPrompt = (outputSchema: z.ZodSchema) => `
You are a helpful assistant that can answer questions and help with tasks.
You have access to a set of tools that you can use to help you answer questions and help with tasks.
You can use the toolList() function to list the tools you have access to.
You can use the loadToolset(toolsetIndex) function to load a toolset.
You can use the unloadToolset(toolsetName) function to unload a toolset.
You can use the callTool(toolName, toolParameters) function to call a tool.

please output your response in the following JSON schema:
${zodToJsonSchema(outputSchema, "ResponseSchema")}
`