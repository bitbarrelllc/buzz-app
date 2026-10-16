// What AgentsView shows, from the sessions each agent's type reports: the
// period's cost, tokens and sessions, and the previous period's cost.
import type {
  Agent,
  SessionUsage,
  UsageSlice,
} from "../../features/agents/service";
import { estimateCost } from "./pricing";

/** One agent's sessions, as its type's `usage` read them. */
export type AgentUsage = Readonly<{
  agent: Agent;
  /** The agent type's key. */
  harness: string;
  sessions: readonly SessionUsage[];
}>;
export type Totals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};
export type Day = Readonly<{
  start: number;
  /** Cost by harness. */
  costs: ReadonlyMap<string, number>;
  total: number;
}>;
export type Stats = Readonly<{
  cost: number;
  previousCost: number;
  tokens: Totals;
  /** Cache reads as a share of the prompt tokens not written to cache;
   * undefined before any. */
  cacheHit?: number;
  sessions: number;
  days: readonly Day[];
  /** Agents with sessions in the period, costliest first. */
  agents: readonly Readonly<{
    agent: Agent;
    harness: string;
    /** The model most of its cost went to. */
    model?: string;
    cost: number;
    sessions: number;
  }>[];
  /** The period's costliest sessions. */
  costliest: readonly Readonly<{
    agent: Agent;
    harness: string;
    session: SessionUsage;
    cost: number;
    tokens: number;
  }>[];
  /** Models used in the period with no recorded cost or known rates. */
  unpriced: readonly string[];
}>;

const COSTLIEST = 5;
const sum = (values: Iterable<number>) => {
  let total = 0;
  for (const value of values) total += value;
  return total;
};
const add = <K>(map: Map<K, number>, key: K, value: number) =>
  map.set(key, (map.get(key) ?? 0) + value);
const sliceCost = (slice: UsageSlice) =>
  slice.costUsd ?? estimateCost(slice.model, slice.tokens);

/** Local midnight `days` days before `at`'s. */
export function dayStart(at: number, days = 0) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

/** The `days` days ending today, `now` being in the last. Sessions should
 * reach back to `since(now, days)`, so the previous period can be compared. */
export const since = (now: number, days: number) => dayStart(now, 2 * days - 1);

export function stats(
  usage: readonly AgentUsage[],
  now: number,
  days: number,
): Stats {
  const start = dayStart(now, days - 1);
  const previous = dayStart(now, 2 * days - 1);
  const dayStarts = Array.from({ length: days }, (_, index) =>
    dayStart(now, days - 1 - index),
  );
  const dayCosts = dayStarts.map(() => new Map<string, number>());
  const dayOf = (hour: number) => {
    let index = dayStarts.length - 1;
    while (index > 0 && (dayStarts[index] ?? 0) > hour) index -= 1;
    return dayCosts[index];
  };
  const tokens: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const unpriced = new Set<string>();
  const agents: Stats["agents"][number][] = [];
  const sessions: Stats["costliest"][number][] = [];
  let previousCost = 0;
  for (const { agent, harness, sessions: list } of usage) {
    const models = new Map<string, number>();
    let agentCost = 0;
    let agentSessions = 0;
    for (const session of list) {
      let cost = 0;
      let count = 0;
      let active = false;
      for (const slice of session.usage) {
        const price = sliceCost(slice);
        if (slice.hour < previous) continue;
        if (slice.hour < start) {
          previousCost += price ?? 0;
          continue;
        }
        active = true;
        if (price === undefined) unpriced.add(slice.model);
        else {
          cost += price;
          add(models, slice.model, price);
          add(dayOf(slice.hour) ?? new Map(), harness, price);
        }
        for (const key of Object.keys(tokens) as (keyof Totals)[]) {
          const value = slice.tokens[key] ?? 0;
          tokens[key] += value;
          count += value;
        }
      }
      if (!active) continue;
      agentSessions += 1;
      agentCost += cost;
      sessions.push({ agent, harness, session, cost, tokens: count });
    }
    if (!agentSessions) continue;
    const model = [...models].sort((a, b) => b[1] - a[1])[0]?.[0];
    agents.push({
      agent,
      harness,
      ...(model ? { model } : {}),
      cost: agentCost,
      sessions: agentSessions,
    });
  }
  const prompt = tokens.input + tokens.cacheRead;
  return {
    cost: sum(agents.map((entry) => entry.cost)),
    previousCost,
    tokens,
    ...(prompt ? { cacheHit: tokens.cacheRead / prompt } : {}),
    sessions: sessions.length,
    days: dayStarts.map((day, index) => {
      const costs = dayCosts[index] ?? new Map<string, number>();
      return { start: day, costs, total: sum(costs.values()) };
    }),
    agents: agents.sort((a, b) => b.cost - a.cost),
    costliest: sessions
      .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
      .slice(0, COSTLIEST),
    unpriced: [...unpriced].sort(),
  };
}

/** A Claude model id as its name, e.g. `claude-opus-5-5` as Claude Opus 5.5;
 * other ids unchanged. */
export function modelName(model: string) {
  const match = /^claude-([a-z]+)-(\d+(?:-\d+)?)(?:-\d{8})?$/.exec(model);
  if (!match?.[1] || !match[2]) return model;
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  return `Claude ${family} ${match[2].replace("-", ".")}`;
}
