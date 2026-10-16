import { expect, it } from "vitest";
import type { Agent, UsageSlice } from "../../features/agents/service";
import { estimateCost } from "./pricing";
import { dayStart, modelName, since, stats } from "./stats";

const HOUR = 3_600_000;
const now = new Date(2026, 9, 16, 15).getTime();
const today = dayStart(now);
const agent = (name: string) =>
  ({ pubkey: name.padEnd(64, "0"), name, type: "x/claude" }) as Agent;
const slice = (
  hour: number,
  tokens: UsageSlice["tokens"],
  model = "claude-opus-5-5",
  costUsd?: number,
): UsageSlice => ({
  hour,
  model,
  tokens,
  ...(costUsd === undefined ? {} : { costUsd }),
});
const session = (id: string, usage: UsageSlice[]) => ({
  id,
  startedAt: usage[0]?.hour ?? 0,
  lastAt: usage.at(-1)?.hour ?? 0,
  usage,
});

it("prices cache writes by how long they are kept, and dated snapshots", () => {
  // 1M of each at Opus 5.5: $4 in, $20 out, $0.20 read; writes 1.25× and 2×.
  expect(
    estimateCost("claude-opus-5-5", {
      input: 1e6,
      output: 1e6,
      cacheRead: 1e6,
      cacheWrite: 2e6,
      cacheWrite1h: 1e6,
    }),
  ).toBeCloseTo(4 + 20 + 0.2 + 5 + 8);
  expect(estimateCost("claude-haiku-4-5-20251001", { input: 1e6 })).toBeCloseTo(
    1,
  );
  expect(estimateCost("claude-opus-9-9", { input: 1e6 })).toBeUndefined();
  expect(estimateCost("gpt-5", { input: 1e6 })).toBeUndefined();
});

it("totals the period, compares the previous one and ranks agents and sessions", () => {
  const pixel = agent("pixel");
  const relay = agent("relay");
  const result = stats(
    [
      {
        agent: pixel,
        harness: "x/claude",
        sessions: [
          session("big", [
            slice(today + 9 * HOUR, { input: 1e6, cacheRead: 3e6 }),
            slice(today + 10 * HOUR, { output: 1e5 }, "claude-sonnet-5-5"),
          ]),
          // Only the previous period: compared, not counted.
          session("old", [slice(dayStart(now, 9), { input: 5e5 })]),
        ],
      },
      {
        agent: relay,
        harness: "x/codex",
        sessions: [
          session("recorded", [
            slice(dayStart(now, 2), { input: 10 }, "gpt-5", 1.5),
            slice(dayStart(now, 1), { input: 10 }, "mystery-1"),
          ]),
        ],
      },
    ],
    now,
    7,
  );
  // Pixel: $4 + $0.60 cache reads + $1 Sonnet output. Relay: its recorded $1.50.
  expect(result.cost).toBeCloseTo(7.1);
  expect(result.previousCost).toBeCloseTo(2);
  expect(result.sessions).toBe(2);
  expect(result.tokens).toEqual({
    input: 1e6 + 20,
    output: 1e5,
    cacheRead: 3e6,
    cacheWrite: 0,
  });
  expect(result.cacheHit).toBeCloseTo(3e6 / (4e6 + 20));
  expect(result.agents.map((entry) => [entry.agent.name, entry.model])).toEqual(
    [
      ["pixel", "claude-opus-5-5"],
      ["relay", "gpt-5"],
    ],
  );
  expect(result.costliest.map((entry) => entry.session.id)).toEqual([
    "big",
    "recorded",
  ]);
  expect(result.unpriced).toEqual(["mystery-1"]);
  expect(result.days).toHaveLength(7);
  expect(result.days.at(-1)).toMatchObject({ start: today });
  expect(result.days.at(-1)?.costs.get("x/claude")).toBeCloseTo(5.6);
  expect(result.days.at(-3)?.costs.get("x/codex")).toBeCloseTo(1.5);
  // Sessions are read back far enough for the previous period.
  expect(since(now, 7)).toBe(dayStart(now, 13));
});

it("names Claude models", () => {
  expect(modelName("claude-opus-5-5")).toBe("Claude Opus 5.5");
  expect(modelName("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
  expect(modelName("claude-sonnet-5")).toBe("Claude Sonnet 5");
  expect(modelName("gpt-5")).toBe("gpt-5");
});
