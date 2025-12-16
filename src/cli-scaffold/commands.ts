/**
 * Commands Module
 * 
 * Export functions from this file to make them available as CLI commands.
 * Each function receives:
 * - args: string[] - positional arguments (after the command name)
 * - options: Record<string, string | boolean | Array<string | boolean>> - named options/flags
 */

export async function hello(
  args: string[],
  options: Record<string, string | boolean | Array<string | boolean>>
) {
  const name = args[0] || options.name || "World";
  const greeting = options.greeting || "Hello";
  
  return `${greeting}, ${name}!`;
}

export async function add(
  args: string[],
  options: Record<string, string | boolean | Array<string | boolean>>
) {
  const numbers = args.map(Number);
  
  if (numbers.some(isNaN)) {
    throw new Error("All arguments must be valid numbers");
  }
  
  const sum = numbers.reduce((a, b) => a + b, 0);
  const verbose = options.verbose || options.v;
  
  if (verbose) {
    return `Sum of ${args.join(" + ")} = ${sum}`;
  }
  
  return sum;
}

export async function greet(
  args: string[],
  options: Record<string, string | boolean | Array<string | boolean>>
) {
  const names = args.length > 0 ? args : ["friend"];
  const uppercase = options.uppercase || options.u;
  
  const greetings = names.map((name) => {
    const greeting = `Hello, ${name}!`;
    return uppercase ? greeting.toUpperCase() : greeting;
  });
  
  return greetings.join("\n");
}

export async function info(
  args: string[],
  options: Record<string, string | boolean | Array<string | boolean>>
) {
  return {
    runtime: "Bun",
    version: Bun.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    args: args,
    options: options,
  };
}