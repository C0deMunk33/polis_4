import { ItemsHelpers, ItemInventory, Item, ItemTemplate, ItemInteractionRequest } from './items';

async function testItemSystem() {
  console.log("=== ITEM SYSTEM TEST ===\n");

  try {
    // Test 1: Create an item template
    console.log("1. Creating item template for 'Magic Coffee Machine'...");
    const template = await ItemsHelpers.createTemplate("A magical coffee machine that can brew different types of coffee and has various states like water level, coffee beans, and temperature.");
    console.log("Template created successfully:");
    console.log(JSON.stringify(template, null, 2));
    console.log("\n" + "=".repeat(50) + "\n");

    // Test 2: Create an item instance
    console.log("2. Creating item instance...");
    const instance = await ItemsHelpers.createItemInstance(template, "A brand new magic coffee machine with full water tank and fresh coffee beans");
    console.log("Instance created successfully:");
    console.log(JSON.stringify(instance, null, 2));
    console.log("\n" + "=".repeat(50) + "\n");

    // Test 3: Create an Item object
    console.log("3. Creating Item object...");
    const item = await Item.create(template, "A brand new magic coffee machine with full water tank and fresh coffee beans");
    console.log("Item created successfully");
    console.log("Initial state:", item.instance.item_state);
    console.log("\n" + "=".repeat(50) + "\n");

    // Test 4: Get item menu
    console.log("4. Getting item menu...");
    const menu = await item.getMenu();
    console.log("Item menu:");
    console.log(menu);
    console.log("\n" + "=".repeat(50) + "\n");

    // Test 5: Perform an interaction
    console.log("5. Performing interaction: brew coffee...");
    const interactionRequest: ItemInteractionRequest = {
      interaction: "brew coffee",
      inputs: {
        "coffee beans": "medium roast",
        "water": "hot"
      },
      intent: "Make a cup of coffee"
    };
    
    const interaction = await item.interact(interactionRequest);
    console.log("Interaction result:");
    console.log(JSON.stringify(interaction, null, 2));
    console.log("Updated item state:", item.instance.item_state);
    console.log("\n" + "=".repeat(50) + "\n");

    // Test 6: Perform another interaction
    console.log("6. Performing interaction: add water...");
    const addWaterRequest: ItemInteractionRequest = {
      interaction: "add water",
      inputs: {
        "water": "cold"
      },
      intent: "Refill the water tank"
    };
    
    const addWaterInteraction = await item.interact(addWaterRequest);
    console.log("Add water interaction result:");
    console.log(JSON.stringify(addWaterInteraction, null, 2));
    console.log("Updated item state:", item.instance.item_state);
    console.log("\n" + "=".repeat(50) + "\n");

    // Test 7: Reset item
    console.log("7. Resetting item to initial state...");
    const resetState = await item.reset();
    console.log("Reset state:", resetState);
    console.log("Current item state:", item.instance.item_state);
    console.log("\n" + "=".repeat(50) + "\n");

    // Test 8: Test inventory system
    console.log("8. Testing inventory system...");
    const inventory = new ItemInventory();
    
    // Create another item for inventory testing
    const template2 = await ItemsHelpers.createTemplate("A simple wooden chair that can be sat on and has a comfort level state");
    const item2 = await Item.create(template2, "A sturdy wooden chair with good craftsmanship");
    
    await inventory.addItem(item);
    await inventory.addItem(item2);
    
    console.log("Inventory item list:");
    console.log(await inventory.getItemList());
    console.log("\n" + "=".repeat(50) + "\n");

    // Test 9: Get menu for specific item in inventory
    console.log("9. Getting menu for item at index 0...");
    const itemMenu = await inventory.getItemMenu(0);
    console.log("Item 0 menu:");
    console.log(itemMenu);
    console.log("\n" + "=".repeat(50) + "\n");

    // Test 10: Interact with item in inventory
    console.log("10. Interacting with item at index 0...");
    const inventoryInteractionRequest: ItemInteractionRequest = {
      interaction: "brew coffee",
      inputs: {
        "coffee beans": "dark roast",
        "water": "hot"
      },
      intent: "Make a strong cup of coffee"
    };
    
    const inventoryInteraction = await inventory.interactWithItem(0, inventoryInteractionRequest);
    console.log("Inventory interaction result:");
    console.log(JSON.stringify(inventoryInteraction, null, 2));
    console.log("\n" + "=".repeat(50) + "\n");

    // Test 11: Test invalid interaction
    console.log("11. Testing invalid interaction...");
    const invalidRequest: ItemInteractionRequest = {
      interaction: "fly to moon",
      inputs: {},
      intent: "Try to make the coffee machine fly"
    };
    
    try {
      const invalidInteraction = await item.interact(invalidRequest);
      console.log("Unexpected success:", invalidInteraction);
    } catch (error) {
      console.log("Expected error for invalid interaction:", error);
    }
    console.log("\n" + "=".repeat(50) + "\n");

    console.log("=== ALL TESTS COMPLETED SUCCESSFULLY ===");

  } catch (error) {
    console.error("Test failed with error:", error);
  }
}

// Run the test
testItemSystem().catch(console.error);
