import { testItemToolsetAdapter } from "./lib/item-toolset-adapter-test";

// Run the item toolset adapter test
console.log("Starting Item Toolset Adapter Demo...\n");

testItemToolsetAdapter()
    .then(() => {
        console.log("\nDemo completed successfully!");
    })
    .catch((error) => {
        console.error("Demo failed:", error);
        process.exit(1);
    }); 