// The token use of an agent's goose sessions, as goose records it on each of
// their replies. goose owns the sessions; nothing here writes or keeps them.
import { promptSections } from "../../features/agents/activity-transcript";
import type { SessionUsage } from "../../features/agents/service";
import type { GooseHistory, Message } from "./transcript";

type Json = Record<string, unknown>;
const HOUR = 3_600_000;

const object = (value: unknown): Json | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** Where Buzz started the session, and what was asked, from its first
 * prompt's context and event. */
function buzzStart(messages: readonly Message[]) {
  const first = messages.find(
    (message) =>
      message.role === "user" && message.metadata?.userVisible !== false,
  );
  const sections = promptSections(
    (first?.content ?? []).map((block) => str(block.text)).join("\n"),
  );
  const field = (name: string) =>
    sections
      .find((section) => section.tag === "context")
      ?.body.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1]
      ?.trim();
  const channelId = field("Channel")?.match(/\(#([^)]+)\)$/)?.[1];
  if (!channelId) return undefined;
  const root = field("Session scope") === "thread" && field("Thread root");
  const title = sections
    .find((section) => section.tag === "buzz-event")
    ?.body.match(/^Content: (.*)$/m)?.[1]
    ?.trim();
  return {
    channelId,
    ...(root ? { root } : {}),
    ...(title ? { title } : {}),
  };
}

/** A session's usage by hour and model. goose counts a reply's cached prompt
 * tokens in its input, and prices the replies it can. */
export function sessionUsage(
  id: string,
  messages: readonly Message[],
): SessionUsage | undefined {
  const start = buzzStart(messages);
  const times = messages.map((message) => message.created * 1000);
  if (!start || !times.length) return undefined;
  type Slice = {
    hour: number;
    model: string;
    tokens: Record<string, number>;
    costUsd: number;
    priced: boolean;
  };
  const slices = new Map<string, Slice>();
  for (const message of messages) {
    const usage = object(message.metadata?.usage);
    if (message.role !== "assistant" || !usage) continue;
    const inference = object(message.metadata?.inference);
    const model =
      str(inference?.requestedModel) ||
      str(inference?.resolvedModel) ||
      "goose";
    const hour = Math.floor((message.created * 1000) / HOUR) * HOUR;
    const key = `${hour}:${model}`;
    const slice = slices.get(key) ?? {
      hour,
      model,
      tokens: {},
      costUsd: 0,
      priced: true,
    };
    slices.set(key, slice);
    const read = count(usage.cacheReadTokens);
    const written = count(usage.cacheWriteTokens);
    const add = {
      input: Math.max(0, count(usage.inputTokens) - read - written),
      output: count(usage.outputTokens),
      cacheRead: read,
      cacheWrite: written,
    };
    for (const [field, value] of Object.entries(add))
      slice.tokens[field] = (slice.tokens[field] ?? 0) + value;
    // A slice with an unpriced reply is priced from its tokens instead.
    if (typeof usage.cost === "number" && Number.isFinite(usage.cost))
      slice.costUsd += usage.cost;
    else slice.priced = false;
  }
  return {
    id,
    ...start,
    startedAt: Math.min(...times),
    lastAt: Math.max(...times),
    usage: [...slices.values()].map(({ priced, costUsd, ...slice }) => ({
      ...slice,
      ...(priced ? { costUsd } : {}),
    })),
  };
}

/** The agent's goose sessions in `workspace` used since `since`. */
export async function readUsage(
  history: GooseHistory,
  agent: string,
  workspace: string,
  since: number,
  signal: AbortSignal,
): Promise<SessionUsage[]> {
  return (await history.sessions(agent, workspace, since, signal))
    .flatMap(({ sessionId, messages }) => {
      const session = sessionUsage(sessionId, messages);
      return session && session.lastAt >= since ? [session] : [];
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}
