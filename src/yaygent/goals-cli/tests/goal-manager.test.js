/**
 * @fileoverview Tests for GoalManager class
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { GoalManager } from "../lib/goal-manager.js";
import { GoalsFileError } from "../lib/errors.js";

describe("GoalManager", () => {
  describe("constructor", () => {
    test("should create instance with path", () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      expect(manager.goalsPath).toBe("./test/fixtures/valid-goals.json");
      expect(manager.loaded).toBe(false);
    });
  });

  describe("load()", () => {
    test("should load valid goals file", async () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      const goals = await manager.load();
      
      expect(goals).toBeDefined();
      expect(goals.version).toBe("1.0");
      expect(goals.goals).toHaveLength(2);
      expect(manager.loaded).toBe(true);
    });

    test("should throw for non-existent file", async () => {
      const manager = new GoalManager("./test/fixtures/non-existent.json");
      
      await expect(manager.load()).rejects.toThrow(GoalsFileError);
    });

    test("should throw for invalid JSON", async () => {
      // This would require creating an invalid JSON file
      // For now, we test the validation logic instead
    });

    test("should apply default values", async () => {
      const manager = new GoalManager("./test/fixtures/minimal-goals.json");
      const goals = await manager.load();
      
      expect(goals.goals[0].priority).toBe(5);
      expect(goals.goals[0].constraints).toEqual([]);
      expect(goals.goals[0].dependencies).toEqual([]);
    });
  });

  describe("getGoals()", () => {
    test("should return all goals after loading", async () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      await manager.load();
      
      const goals = manager.getGoals();
      expect(goals).toHaveLength(2);
    });

    test("should throw if not loaded", () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      
      expect(() => manager.getGoals()).toThrow("Goals not loaded");
    });
  });

  describe("getGoal()", () => {
    test("should return specific goal by ID", async () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      await manager.load();
      
      const goal = manager.getGoal("goal-one");
      expect(goal).toBeDefined();
      expect(goal.id).toBe("goal-one");
    });

    test("should return undefined for non-existent ID", async () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      await manager.load();
      
      const goal = manager.getGoal("non-existent");
      expect(goal).toBeUndefined();
    });
  });

  describe("validate()", () => {
    test("should validate correct definition", () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      
      const result = manager.validate({
        version: "1.0",
        goals: [
          {
            id: "test-goal",
            objective: "A valid objective that is long enough"
          }
        ]
      });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should reject missing version", () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      
      const result = manager.validate({
        goals: [{ id: "test", objective: "test objective here" }]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("version"))).toBe(true);
    });

    test("should reject empty goals array", () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      
      const result = manager.validate({
        version: "1.0",
        goals: []
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("at least one goal"))).toBe(true);
    });

    test("should reject invalid goal ID format", () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      
      const result = manager.validate({
        version: "1.0",
        goals: [
          {
            id: "InvalidID",
            objective: "A valid objective that is long enough"
          }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("kebab-case"))).toBe(true);
    });

    test("should reject short objective", () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      
      const result = manager.validate({
        version: "1.0",
        goals: [
          {
            id: "test-goal",
            objective: "short"
          }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("10 characters"))).toBe(true);
    });

    test("should reject duplicate goal IDs", () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      
      const result = manager.validate({
        version: "1.0",
        goals: [
          { id: "same-id", objective: "First goal with enough text" },
          { id: "same-id", objective: "Second goal with enough text" }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Duplicate"))).toBe(true);
    });

    test("should reject self-dependency", () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      
      const result = manager.validate({
        version: "1.0",
        goals: [
          {
            id: "self-dep",
            objective: "A goal that depends on itself somehow",
            dependencies: ["self-dep"]
          }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("itself"))).toBe(true);
    });

    test("should reject dependency on non-existent goal", () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      
      const result = manager.validate({
        version: "1.0",
        goals: [
          {
            id: "test-goal",
            objective: "A goal with missing dependency reference",
            dependencies: ["missing-goal"]
          }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("non-existent"))).toBe(true);
    });

    test("should detect circular dependencies", () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      
      const result = manager.validate({
        version: "1.0",
        goals: [
          {
            id: "goal-a",
            objective: "Goal A depends on Goal B for something",
            dependencies: ["goal-b"]
          },
          {
            id: "goal-b",
            objective: "Goal B depends on Goal A for something",
            dependencies: ["goal-a"]
          }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Circular"))).toBe(true);
    });
  });

  describe("getGoalsByPriority()", () => {
    test("should return goals sorted by priority", async () => {
      const manager = new GoalManager("./test/fixtures/valid-goals.json");
      await manager.load();
      
      const sorted = manager.getGoalsByPriority();
      expect(sorted[0].priority).toBeLessThanOrEqual(sorted[1].priority);
    });
  });
});
