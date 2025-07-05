import OpenAI from "openai"
import 'dotenv/config'
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema'; // Add this import

const BASE_URL = "https://api.venice.ai/api/v1"
const VENICE_API_KEY = process.env.VENICE_API_KEY

interface Message {
  role: "user" | "assistant" | "system"
  content: string
}

const testSchema = z.object({
  capital: z.string().describe("The capital of the country"),
  country: z.string().describe("The country")
})

type TestSchema = z.infer<typeof testSchema> // Capitalized type name

export const getStructuredOutput = async (
  systemPrompt: string, 
  messages: Message[], 
  model: string = 'venice-uncensored', 
  schema: z.ZodSchema // Better typing
) => {
  const client = new OpenAI({
    apiKey: VENICE_API_KEY,
    baseURL: BASE_URL
  })

  // Convert Zod schema to JSON Schema
  const jsonSchema = zodToJsonSchema(schema, "ResponseSchema")

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt }, // Include system prompt
      ...messages
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ResponseSchema",
        schema: jsonSchema
      }
    },
    stream: false
  })

  return response.choices[0].message.content
}
/*
// Example usage
(async () => {
  const systemPrompt = "You are a helpful assistant that can answer questions and help with tasks."
  const messages: Message[] = [
    { role: "user", content: "What is the capital of France?" }
  ]
  
  const response = await getStructuredOutput(systemPrompt, messages, "venice-uncensored", testSchema)
  console.log(response)
  
  // Parse the response back to your type
  const parsed = testSchema.parse(JSON.parse(response!))
  console.log(parsed) // Fully typed result
})()*/