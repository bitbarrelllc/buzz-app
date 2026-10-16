// The token use of an agent's Codex threads, read from the rollout files Codex
// keeps on this computer. Codex owns the files; nothing here writes or keeps
// them.
import { readFile } from "../../buzz-mcp/app-client";
import { promptSections } from "../../features/agents/activity-transcript";
import type { SessionUsage, UsageSlice } from "../../features/agents/service";
import type { AppServer, Spawn } from "./rpc";
import { withServer } from "./transcript";

type Json = Record<string, unknown>;
type Thread = { id: string; path: string | null; updatedAt: number };
const HOUR = 3_600_000;
/** Files read at once. */
const READERS = 4;

const object = (value: unknown): Json | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
const text = (content: unknown) =>
  (Array.isArray(content) ? content : [])
    .map((part) => str(object(part)?.text))
    .join("\n");

/** Where Buzz started the thread, and what was asked, from its first prompt. */
function buzzStart(prompt: string) {
  const sections = promptSections(prompt);
  let context: Json | undefined;
  try {
    context = object(
      JSON.parse(sections.find((part) => part.tag === "context")?.body ?? ""),
    );
  } catch {
    return undefined;
  }
  const channelId = str(context?.channel_id);
  if (!channelId) return undefined;
  const root = str(context?.session_thread);
  let title = "";
  for (const { body } of sections) {
    const request = /^Request: (".*")$/m.exec(body)?.[1];
    if (!request) continue;
    try {
      title = str(JSON.parse(request)).split("\n")[0]?.trim() ?? "";
    } catch {}
    break;
  }
  return {
    channelId,
    ...(root ? { root } : {}),
    ...(title ? { title } : {}),
  };
}

type Slice = UsageSlice & { tokens: Json };

/** Adds a rollout's tokens to `slices`, by hour and model, and says whose it
 * is: Buzz's agent's when its developer instructions open with the agent's
 * pubkey. Codex records each model response's tokens once, its input
 * including the cached part. */
function read(file: string, agent: string, slices: Map<string, Slice>) {
  // A teammate's pubkey can appear in the team section; the agent's own
  // opens a line of its instructions.
  const identity = new RegExp(`^You are .* \\(pubkey ${agent}\\)`, "m");
  let mine = false;
  let start: ReturnType<typeof buzzStart>;
  let model = "";
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const line of file.split("\n")) {
    let entry: Json | undefined;
    try {
      entry = object(JSON.parse(line));
    } catch {
      // A partial last line is still being written.
      continue;
    }
    const payload = object(entry?.payload);
    const at = Date.parse(str(entry?.timestamp));
    if (!entry || !payload || !at) continue;
    first = Math.min(first, at);
    last = Math.max(last, at);
    if (entry.type === "turn_context") model = str(payload.model) || model;
    if (entry.type === "response_item" && payload.type === "message") {
      const prompt = text(payload.content);
      if (payload.role === "developer" && identity.test(prompt)) mine = true;
      if (payload.role === "user" && !start) start = buzzStart(prompt);
    }
    const usage = object(payload.usage);
    if (entry.type !== "token_usage_record" || !usage) continue;
    const hour = Math.floor(at / HOUR) * HOUR;
    const name = model || "codex";
    const key = `${hour}:${name}`;
    const slice = slices.get(key) ?? { hour, model: name, tokens: {} };
    slices.set(key, slice);
    const cached = count(usage.cached_input_tokens);
    const written = count(usage.cache_write_input_tokens);
    const add = {
      input: Math.max(0, count(usage.input_tokens) - cached - written),
      output: count(usage.output_tokens),
      cacheRead: cached,
      cacheWrite: written,
    };
    for (const [field, value] of Object.entries(add))
      slice.tokens[field] = count(slice.tokens[field]) + value;
  }
  return { mine, start, first, last };
}

/** A thread's usage, with the subagent threads it spawned, when Buzz started
 * it for `agent`. */
export function rolloutUsage(
  id: string,
  file: string,
  subagents: readonly string[],
  agent: string,
): SessionUsage | undefined {
  const slices = new Map<string, Slice>();
  const thread = read(file, agent, slices);
  if (!thread.mine || !thread.start || !thread.last) return undefined;
  let { first, last } = thread;
  for (const subagent of subagents) {
    const spent = read(subagent, agent, slices);
    first = Math.min(first, spent.first);
    last = Math.max(last, spent.last);
  }
  return {
    id,
    ...thread.start,
    startedAt: first,
    lastAt: last,
    usage: [...slices.values()],
  };
}

/** Every thread `thread/list` finds with `params`, a page at a time. */
async function list(rpc: AppServer, params: Json) {
  const found: Thread[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: Thread[]; nextCursor: string | null } =
      await rpc.request("thread/list", {
        ...params,
        limit: 50,
        ...(cursor ? { cursor } : {}),
      });
    found.push(...page.data);
    cursor = page.data.length ? page.nextCursor : null;
  } while (cursor);
  return found;
}

/** The subagent threads `parent` spawned, and theirs. */
async function spawned(rpc: AppServer, parent: string): Promise<Thread[]> {
  const children = await list(rpc, { parentThreadId: parent });
  const nested = await Promise.all(
    children.map((child) => spawned(rpc, child.id)),
  );
  return [...children, ...nested.flat()];
}

/** The agent's Codex threads in use since `since`, found by the agent's name
 * in their thread names and kept when their rollout names its pubkey. */
export async function readUsage(
  spawn: Spawn,
  agent: Readonly<{ pubkey: string; name: string }>,
  since: number,
  signal: AbortSignal,
): Promise<SessionUsage[]> {
  const queue = await withServer(spawn, signal, async (rpc) => {
    const named = await list(rpc, { searchTerm: `· ${agent.name}` });
    return Promise.all(
      named
        .filter((thread) => thread.updatedAt * 1000 >= since)
        .map(async (thread) => ({
          thread,
          subagents: await spawned(rpc, thread.id),
        })),
    );
  });
  const rollout = async ({ path }: Thread) => {
    if (!path?.endsWith(".jsonl")) return undefined;
    const slash = path.lastIndexOf("/");
    try {
      return new TextDecoder().decode(
        await readFile(
          spawn,
          path.slice(0, slash),
          `./${path.slice(slash + 1)}`,
          signal,
        ),
      );
    } catch (error) {
      signal.throwIfAborted();
      if (/no such file/i.test(error instanceof Error ? error.message : ""))
        return undefined;
      throw error;
    }
  };
  const found: SessionUsage[] = [];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const file = await rollout(next.thread);
      if (file === undefined) continue;
      const subagents = await Promise.all(next.subagents.map(rollout));
      const session = rolloutUsage(
        next.thread.id,
        file,
        subagents.filter((text) => text !== undefined),
        agent.pubkey,
      );
      if (session && session.lastAt >= since) found.push(session);
    }
  };
  await Promise.all(Array.from({ length: READERS }, worker));
  return found.sort((a, b) => b.lastAt - a.lastAt);
}
