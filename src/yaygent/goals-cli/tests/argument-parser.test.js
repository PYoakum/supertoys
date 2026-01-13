/**
 * @fileoverview Tests for argument parser
 */

import { describe, test, expect } from "bun:test";
import { 
  parseArguments, 
  validateRequiredArgs, 
  getVersion, 
  getHelpText 
} from "../lib/argument-parser.js";

describe("Argument Parser", () => {
  describe("parseArguments()", () => {
    test("should parse required arguments", () => {
      const args = parseArguments([
        "--goals", "./goals.json",
        "--context", "./context/"
      ]);
      
      expect(args.goals).toBe("./goals.json");
      expect(args.context).toBe("./context/");
      expect(args.errors).toHaveLength(0);
    });

    test("should parse short aliases", () => {
      const args = parseArguments([
        "-g", "./goals.json",
        "-c", "./context/"
      ]);
      
      expect(args.goals).toBe("./goals.json");
      expect(args.context).toBe("./context/");
    });

    test("should parse optional arguments", () => {
      const args = parseArguments([
        "-g", "./goals.json",
        "-c", "./context/",
        "--config", "./my-config.js",
        "--output", "output.json",
        "--format", "markdown",
        "--verbose",
        "--dry-run"
      ]);
      
      expect(args.config).toBe("./my-config.js");
      expect(args.output).toBe("output.json");
      expect(args.format).toBe("markdown");
      expect(args.verbose).toBe(true);
      expect(args.dryRun).toBe(true);
    });

    test("should parse boolean flags", () => {
      const args = parseArguments(["--help"]);
      expect(args.help).toBe(true);
      
      const args2 = parseArguments(["--version"]);
      expect(args2.version).toBe(true);
      
      const args3 = parseArguments(["-v"]);
      expect(args3.verbose).toBe(true);
    });

    test("should use default values", () => {
      const args = parseArguments([]);
      
      expect(args.config).toBe("./configuration.js");
      expect(args.output).toBe("stdout");
      expect(args.format).toBe("json");
      expect(args.verbose).toBe(false);
      expect(args.dryRun).toBe(false);
    });

    test("should report unknown arguments", () => {
      const args = parseArguments(["--unknown", "--invalid"]);
      
      expect(args.errors.length).toBeGreaterThan(0);
      expect(args.errors.some(e => e.includes("unknown"))).toBe(true);
    });

    test("should report missing values for string arguments", () => {
      const args = parseArguments(["--goals"]);
      
      expect(args.errors.length).toBeGreaterThan(0);
      expect(args.errors.some(e => e.includes("requires a value"))).toBe(true);
    });

    test("should validate format option", () => {
      const args = parseArguments([
        "-g", "./goals.json",
        "-c", "./context/",
        "-f", "invalid"
      ]);
      
      expect(args.errors.length).toBeGreaterThan(0);
      expect(args.errors.some(e => e.includes("Invalid format"))).toBe(true);
    });
  });

  describe("validateRequiredArgs()", () => {
    test("should return errors for missing required args", () => {
      const args = { goals: null, context: null };
      const errors = validateRequiredArgs(args);
      
      expect(errors.length).toBe(2);
      expect(errors.some(e => e.includes("--goals"))).toBe(true);
      expect(errors.some(e => e.includes("--context"))).toBe(true);
    });

    test("should return empty array for valid args", () => {
      const args = { goals: "./goals.json", context: "./context/" };
      const errors = validateRequiredArgs(args);
      
      expect(errors).toHaveLength(0);
    });

    test("should skip validation for help flag", () => {
      const args = { goals: null, context: null, help: true };
      const errors = validateRequiredArgs(args);
      
      expect(errors).toHaveLength(0);
    });

    test("should skip validation for version flag", () => {
      const args = { goals: null, context: null, version: true };
      const errors = validateRequiredArgs(args);
      
      expect(errors).toHaveLength(0);
    });
  });

  describe("getVersion()", () => {
    test("should return version string", () => {
      const version = getVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("getHelpText()", () => {
    test("should return help text", () => {
      const help = getHelpText();
      expect(help).toContain("Goals CLI");
      expect(help).toContain("--goals");
      expect(help).toContain("--context");
      expect(help).toContain("Examples");
    });
  });
});
