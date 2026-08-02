import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createRoutingBudget,
  DEFAULT_ROUTING_STAGE_BUDGET_MS,
  MIN_USEFUL_REQUEST_MS,
} from "../../src/routing/routingBudget.js";
import { createFakeClock } from "./helpers/fakeClock.js";

describe("routingBudget", () => {
  test("default stage budget is 5 minutes", () => {
    const clock = createFakeClock();
    const budget = createRoutingBudget(clock);
    assert.equal(budget.totalMs, DEFAULT_ROUTING_STAGE_BUDGET_MS);
    assert.equal(budget.remainingMs(), DEFAULT_ROUTING_STAGE_BUDGET_MS);
  });

  test("requestTimeoutMs is clipped by remaining budget", () => {
    const clock = createFakeClock();
    const budget = createRoutingBudget(clock, 10_000);
    assert.equal(budget.requestTimeoutMs(180_000), 10_000);
    clock.advance(7_000);
    assert.equal(budget.requestTimeoutMs(180_000), 3_000);
    assert.equal(budget.requestTimeoutMs(1_000), 1_000);
  });

  test("canStartRequest requires minimum useful remaining budget", () => {
    const clock = createFakeClock();
    const budget = createRoutingBudget(clock, MIN_USEFUL_REQUEST_MS);
    assert.equal(budget.canStartRequest(), true);
    clock.advance(1);
    assert.equal(budget.canStartRequest(), false);
    assert.equal(budget.requestTimeoutMs(180_000), MIN_USEFUL_REQUEST_MS - 1);
  });

  test("hasBudgetFor compares against remaining", () => {
    const clock = createFakeClock();
    const budget = createRoutingBudget(clock, 5_000);
    assert.equal(budget.hasBudgetFor(5_000), true);
    assert.equal(budget.hasBudgetFor(5_001), false);
  });
});
