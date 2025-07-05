import { Toolset, ToolCall } from "./toolset";
import { Menu } from "./menu";

// Demo Toolset 1: Calculator Tools
const calculatorTools = [
    {
        name: "add",
        description: "Add two numbers together",
        parameters: [
            { name: "a", description: "First number", type: "number", enum: [], default: "0" },
            { name: "b", description: "Second number", type: "number", enum: [], default: "0" }
        ]
    },
    {
        name: "multiply",
        description: "Multiply two numbers",
        parameters: [
            { name: "a", description: "First number", type: "number", enum: [], default: "1" },
            { name: "b", description: "Second number", type: "number", enum: [], default: "1" }
        ]
    },
    {
        name: "divide",
        description: "Divide first number by second number",
        parameters: [
            { name: "a", description: "Numerator", type: "number", enum: [], default: "1" },
            { name: "b", description: "Denominator", type: "number", enum: [], default: "1" }
        ]
    }
];

const calculatorCallback = (toolcall: ToolCall): string => {
    switch (toolcall.name) {
        case "add":
            return `Result: ${toolcall.parameters.a + toolcall.parameters.b}`;
        case "multiply":
            return `Result: ${toolcall.parameters.a * toolcall.parameters.b}`;
        case "divide":
            if (toolcall.parameters.b === 0) {
                return "Error: Cannot divide by zero";
            }
            return `Result: ${toolcall.parameters.a / toolcall.parameters.b}`;
        default:
            return "Unknown calculator operation";
    }
};

// Demo Toolset 2: String Tools
const stringTools = [
    {
        name: "uppercase",
        description: "Convert string to uppercase",
        parameters: [
            { name: "text", description: "Text to convert", type: "string", enum: [], default: "" }
        ]
    },
    {
        name: "reverse",
        description: "Reverse a string",
        parameters: [
            { name: "text", description: "Text to reverse", type: "string", enum: [], default: "" }
        ]
    },
    {
        name: "countWords",
        description: "Count words in a string",
        parameters: [
            { name: "text", description: "Text to count words in", type: "string", enum: [], default: "" }
        ]
    }
];

const stringCallback = (toolcall: ToolCall): string => {
    switch (toolcall.name) {
        case "uppercase":
            return `Result: ${toolcall.parameters.text.toUpperCase()}`;
        case "reverse":
            return `Result: ${toolcall.parameters.text.split('').reverse().join('')}`;
        case "countWords":
            const words = toolcall.parameters.text.trim().split(/\s+/).filter((word: string) => word.length > 0);
            return `Result: ${words.length} words`;
        default:
            return "Unknown string operation";
    }
};

// Demo Toolset 3: Utility Tools
const utilityTools = [
    {
        name: "getTime",
        description: "Get current timestamp",
        parameters: []
    },
    {
        name: "randomNumber",
        description: "Generate a random number between min and max",
        parameters: [
            { name: "min", description: "Minimum value", type: "number", enum: [], default: "0" },
            { name: "max", description: "Maximum value", type: "number", enum: [], default: "100" }
        ]
    },
    {
        name: "formatDate",
        description: "Format current date",
        parameters: [
            { name: "format", description: "Date format", type: "string", enum: ["short", "long", "iso"], default: "short" }
        ]
    }
];

const utilityCallback = (toolcall: ToolCall): string => {
    switch (toolcall.name) {
        case "getTime":
            return `Current timestamp: ${Date.now()}`;
        case "randomNumber":
            const min = toolcall.parameters.min || 0;
            const max = toolcall.parameters.max || 100;
            const random = Math.floor(Math.random() * (max - min + 1)) + min;
            return `Random number: ${random}`;
        case "formatDate":
            const now = new Date();
            switch (toolcall.parameters.format) {
                case "long":
                    return `Date: ${now.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                    })}`;
                case "iso":
                    return `Date: ${now.toISOString()}`;
                default:
                    return `Date: ${now.toLocaleDateString()}`;
            }
        default:
            return "Unknown utility operation";
    }
};

// Create toolsets
const calculatorToolset = new Toolset("Calculator", calculatorTools, calculatorCallback);
const stringToolset = new Toolset("String Utils", stringTools, stringCallback);
const utilityToolset = new Toolset("Utilities", utilityTools, utilityCallback);

// Test function
export function testMenu() {
    console.log("=== Testing Menu System ===\n");
    
    // Create menu with toolsets
    const menu = new Menu([calculatorToolset, stringToolset, utilityToolset]);
    
    // Test 1: Show initial menu
    console.log("1. Initial Menu:");
    console.log(menu.getMenu());
    console.log();
    
    // Test 2: Load calculator toolset
    console.log("2. Loading Calculator Toolset:");
    const loadResult = menu.parseToolCall({ name: "loadToolset", parameters: { toolsetIndex: 0 } });
    console.log(loadResult);
    console.log(menu.getMenu());
    console.log();
    
    // Test 3: Use calculator tools
    console.log("3. Testing Calculator Tools:");
    console.log("Adding 5 + 3:");
    console.log(menu.parseToolCall({ name: "add", parameters: { a: 5, b: 3 } }));
    console.log();
    
    console.log("Multiplying 4 * 7:");
    console.log(menu.parseToolCall({ name: "multiply", parameters: { a: 4, b: 7 } }));
    console.log();
    
    console.log("Dividing 15 / 3:");
    console.log(menu.parseToolCall({ name: "divide", parameters: { a: 15, b: 3 } }));
    console.log();
    
    // Test 4: Return to toolset menu
    console.log("4. Returning to Toolset Menu:");
    console.log(menu.parseToolCall({ name: "toolList", parameters: {} }));
    console.log(menu.getMenu());
    console.log();
    
    // Test 5: Load string toolset
    console.log("5. Loading String Utils Toolset:");
    console.log(menu.parseToolCall({ name: "loadToolset", parameters: { toolsetIndex: 1 } }));
    console.log(menu.getMenu());
    console.log();
    
    // Test 6: Use string tools
    console.log("6. Testing String Tools:");
    console.log("Uppercase 'hello world':");
    console.log(menu.parseToolCall({ name: "uppercase", parameters: { text: "hello world" } }));
    console.log();
    
    console.log("Reverse 'hello':");
    console.log(menu.parseToolCall({ name: "reverse", parameters: { text: "hello" } }));
    console.log();
    
    console.log("Count words in 'This is a test sentence':");
    console.log(menu.parseToolCall({ name: "countWords", parameters: { text: "This is a test sentence" } }));
    console.log();
    
    // Test 7: Load utility toolset
    console.log("7. Loading Utilities Toolset:");
    console.log(menu.parseToolCall({ name: "toolList", parameters: {} }));
    console.log(menu.parseToolCall({ name: "loadToolset", parameters: { toolsetIndex: 2 } }));
    console.log(menu.getMenu());
    console.log();
    
    // Test 8: Use utility tools
    console.log("8. Testing Utility Tools:");
    console.log("Get current time:");
    console.log(menu.parseToolCall({ name: "getTime", parameters: {} }));
    console.log();
    
    console.log("Generate random number (1-10):");
    console.log(menu.parseToolCall({ name: "randomNumber", parameters: { min: 1, max: 10 } }));
    console.log();
    
    console.log("Format date (long):");
    console.log(menu.parseToolCall({ name: "formatDate", parameters: { format: "long" } }));
    console.log();
    
    // Test 9: Error handling
    console.log("9. Testing Error Handling:");
    console.log("Try to use tool without loading toolset:");
    console.log(menu.parseToolCall({ name: "toolList", parameters: {} }));
    console.log(menu.parseToolCall({ name: "add", parameters: { a: 1, b: 2 } }));
    console.log();
    
    console.log("Try to use non-existent tool:");
    console.log(menu.parseToolCall({ name: "loadToolset", parameters: { toolsetIndex: 0 } }));
    console.log(menu.parseToolCall({ name: "nonexistent", parameters: {} }));
    console.log();
    
    console.log("=== Test Complete ===");
}

// Export toolsets for potential reuse
export { calculatorToolset, stringToolset, utilityToolset };
