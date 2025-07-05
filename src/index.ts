/**
 * Main entry point for the application
 */

function greet(name: string): string {
  return `Hello, ${name}!`;
}

function main(): void {
  console.log(greet("World"));
  console.log("TypeScript project is running!");
}

// Run the main function
main(); 