import { Menu } from "./menu";
import { ItemToolsetAdapter } from "./item-toolset-adapter";
import { ItemsHelpers, Item } from "./items";

async function testItemToolsetAdapter() {
    console.log("=== Item Toolset Adapter Test ===\n");

    try {
        // Create some test items
        console.log("1. Creating test items...");
        
        // Create a coffee machine item
        const coffeeMachineTemplate = await ItemsHelpers.createTemplate(
            "A modern coffee machine that can brew different types of coffee. It has a water tank, coffee bean hopper, and can make espresso, cappuccino, and regular coffee."
        );
        const coffeeMachine = await Item.create(coffeeMachineTemplate, "A brand new coffee machine with full water tank and coffee beans");
        
        // Create a microwave item
        const microwaveTemplate = await ItemsHelpers.createTemplate(
            "A standard microwave oven that can heat food, defrost items, and has various power settings. It has a turntable and digital display."
        );
        const microwave = await Item.create(microwaveTemplate, "A clean microwave with working turntable and display");
        
        console.log("✓ Created coffee machine and microwave items\n");

        // Test 1: Individual items as self-contained toolsets
        console.log("2. Testing individual items as self-contained toolsets...");
        const coffeeToolset = ItemToolsetAdapter.createToolsetFromItem(coffeeMachine);
        const microwaveToolset = ItemToolsetAdapter.createToolsetFromItem(microwave);
        
        console.log("Coffee Machine Toolset created with tools:");
        coffeeToolset.getTools().forEach(tool => {
            console.log(`  - ${tool.name}: ${tool.description}`);
        });
        console.log();
        
        console.log("Microwave Toolset created with tools:");
        microwaveToolset.getTools().forEach(tool => {
            console.log(`  - ${tool.name}: ${tool.description}`);
        });
        console.log();

        // Test 2: Creating individual toolsets from collection
        console.log("3. Testing createIndividualToolsets method...");
        const individualToolsets = ItemToolsetAdapter.createIndividualToolsets([coffeeMachine, microwave]);
        console.log(`Created ${individualToolsets.length} individual toolsets`);
        individualToolsets.forEach((toolset, index) => {
            console.log(`  Toolset ${index}: ${toolset.name} with ${toolset.getTools().length} tools`);
        });
        console.log();

        // Test 3: Item collection toolset for management
        console.log("4. Testing item collection toolset...");
        const collectionToolset = ItemToolsetAdapter.createItemCollectionToolset([coffeeMachine, microwave], "Kitchen Collection");
        console.log("Kitchen Collection Toolset created with tools:");
        collectionToolset.getTools().forEach(tool => {
            console.log(`  - ${tool.name}: ${tool.description}`);
        });
        console.log();

        // Test 4: Menu integration
        console.log("5. Testing menu integration...");
        const menu = new Menu([coffeeToolset, microwaveToolset, collectionToolset]);
        
        console.log("Initial menu:");
        console.log(menu.getMenu());
        console.log();

        // Test loading a toolset
        console.log("6. Testing toolset loading...");
        const loadResult = menu.parseToolCall({ name: "loadToolset", parameters: { toolsetIndex: 0 } });
        console.log(`Load result: ${loadResult}`);
        console.log("Menu after loading coffee toolset:");
        console.log(menu.getMenu());
        console.log();

        // Test calling a tool
        console.log("7. Testing tool execution...");
        const toolResult = menu.parseToolCall({ 
            name: "brew", 
            parameters: { 
                "coffee_type": "espresso",
                "amount": "1 cup"
            } 
        });
        console.log(`Tool execution result: ${toolResult}`);
        console.log();

        // Test resetting the item
        console.log("8. Testing reset tool...");
        const itemResetResult = menu.parseToolCall({ name: "reset", parameters: {} });
        console.log(`Reset result: ${itemResetResult}`);
        console.log();

        // Test returning to toolset menu
        console.log("9. Testing return to toolset menu...");
        const returnResult = menu.parseToolCall({ name: "toolList", parameters: {} });
        console.log(`Return result: ${returnResult}`);
        console.log("Menu after returning to toolset menu:");
        console.log(menu.getMenu());
        console.log();

        // Test loading the collection toolset
        console.log("10. Testing collection toolset...");
        menu.parseToolCall({ name: "loadToolset", parameters: { toolsetIndex: 2 } });
        console.log("Menu after loading collection toolset:");
        console.log(menu.getMenu());
        console.log();

        // Test listing items
        console.log("11. Testing list items tool...");
        const listResult = menu.parseToolCall({ name: "listItems", parameters: {} });
        console.log(`List items result: ${listResult}`);
        console.log();

        // Test getting item menu
        console.log("12. Testing get item menu tool...");
        const menuResult = menu.parseToolCall({ name: "getItemMenu", parameters: { itemIndex: 0 } });
        console.log(`Get item menu result: ${menuResult}`);
        console.log();

        // Test interacting with item through collection
        console.log("13. Testing interact with item tool...");
        const interactResult = menu.parseToolCall({ 
            name: "interactWithItem", 
            parameters: { 
                itemIndex: 0,
                interaction: "brew",
                inputs: JSON.stringify({ "coffee_type": "cappuccino", "amount": "1 cup" })
            } 
        });
        console.log(`Interact with item result: ${interactResult}`);
        console.log();

        console.log("=== Test completed successfully! ===");

    } catch (error) {
        console.error("Test failed with error:", error);
    }
}

// Export the test function so it can be called from other files
export { testItemToolsetAdapter };

// Run the test if this file is executed directly
if (require.main === module) {
    testItemToolsetAdapter();
} 