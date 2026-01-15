/**
 * @fileoverview Tests for ContextLoader class
 */

import { describe, test, expect } from "bun:test";
import { ContextLoader } from "../lib/context-loader.js";
import { ContextError } from "../lib/errors.js";

describe("ContextLoader", () => {
  describe("constructor", () => {
    test("should create instance with path and default options", () => {
      const loader = new ContextLoader("./tests/fixtures/context");
      expect(loader.contextPath).toBe("./tests/fixtures/context");
      expect(loader.options.recursive).toBe(true);
      expect(loader.loaded).toBe(false);
    });

    test("should accept custom options", () => {
      const loader = new ContextLoader("./tests/fixtures/context", {
        recursive: false,
        extensions: [".md", ".txt"]
      });
      expect(loader.options.recursive).toBe(false);
      expect(loader.options.extensions).toEqual([".md", ".txt"]);
    });
  });

  describe("load()", () => {
    test("should load files from directory", async () => {
      const loader = new ContextLoader("./tests/fixtures/context");
      const bundle = await loader.load();
      
      expect(bundle).toBeDefined();
      expect(bundle.files.length).toBeGreaterThan(0);
      expect(bundle.metadata.totalFiles).toBeGreaterThan(0);
      expect(loader.loaded).toBe(true);
    });

    test("should throw for non-existent directory", async () => {
      const loader = new ContextLoader("./tests/fixtures/non-existent");
      
      await expect(loader.load()).rejects.toThrow(ContextError);
    });

    test("should include file metadata", async () => {
      const loader = new ContextLoader("./tests/fixtures/context");
      const bundle = await loader.load();
      
      const file = bundle.files[0];
      expect(file.path).toBeDefined();
      expect(file.content).toBeDefined();
      expect(file.extension).toBeDefined();
      expect(file.size).toBeGreaterThan(0);
      expect(file.modified).toBeInstanceOf(Date);
    });
  });

  describe("getFormattedContext()", () => {
    test("should format as XML", async () => {
      const loader = new ContextLoader("./tests/fixtures/context");
      await loader.load();
      
      const xml = loader.getFormattedContext("xml");
      expect(xml).toContain("<context>");
      expect(xml).toContain("</context>");
      expect(xml).toContain("<file");
    });

    test("should format as Markdown", async () => {
      const loader = new ContextLoader("./tests/fixtures/context");
      await loader.load();
      
      const md = loader.getFormattedContext("markdown");
      expect(md).toContain("# Context Files");
      expect(md).toContain("##");
      expect(md).toContain("```");
    });

    test("should format as JSON", async () => {
      const loader = new ContextLoader("./tests/fixtures/context");
      await loader.load();
      
      const json = loader.getFormattedContext("json");
      const parsed = JSON.parse(json);
      expect(parsed.files).toBeDefined();
      expect(parsed.metadata).toBeDefined();
    });

    test("should throw for unknown format", async () => {
      const loader = new ContextLoader("./tests/fixtures/context");
      await loader.load();
      
      expect(() => loader.getFormattedContext("unknown")).toThrow("Unknown format");
    });

    test("should throw if not loaded", () => {
      const loader = new ContextLoader("./tests/fixtures/context");
      
      expect(() => loader.getFormattedContext("xml")).toThrow("not loaded");
    });
  });

  describe("getMetadata()", () => {
    test("should return metadata after loading", async () => {
      const loader = new ContextLoader("./tests/fixtures/context");
      await loader.load();
      
      const metadata = loader.getMetadata();
      expect(metadata.totalFiles).toBeGreaterThan(0);
      expect(metadata.totalSize).toBeGreaterThan(0);
      expect(metadata.byExtension).toBeDefined();
    });
  });

  describe("getFilesByExtension()", () => {
    test("should filter files by extension", async () => {
      const loader = new ContextLoader("./tests/fixtures/context");
      await loader.load();
      
      const mdFiles = loader.getFilesByExtension(".md");
      for (const file of mdFiles) {
        expect(file.extension).toBe(".md");
      }
    });

    test("should accept extension without dot", async () => {
      const loader = new ContextLoader("./tests/fixtures/context");
      await loader.load();
      
      const mdFiles = loader.getFilesByExtension("md");
      for (const file of mdFiles) {
        expect(file.extension).toBe(".md");
      }
    });
  });
});
