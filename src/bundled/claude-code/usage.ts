// The token use of an agent's Claude Code sessions, read from the transcripts
// Claude Code keeps on this computer. Claude Code owns the files; nothing here
// writes or keeps them.
import { readFile } from "../../buzz-mcp/app-client";
import { promptSections } from "../../features/agents/activity-transcript";
import type { SessionUsage, UsageSlice } from "../../features/agents/service";
import type { Spawn } from "./claude";
import { searchProject, workspaceProject } from "./transcript";

type Json = Record<string, unknown>;
const HOUR = 3_600_000;
/** Files read at once. */
const READERS = 4;

const object = (value: unknown): Json | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
const lines = (file: string) =>
  file.split("\n").flatMap((line) => {
    try {
      const entry = object(JSON.parse(line));
      return entry ? [entry] : [];
    } catch {
      // A partial last line is still being written.
      return [];
    }
  });
const promptText = (content: unknown) =>
  typeof content === "string"
    ? content
    : (Array.isArray(content) ? content : [])
        .map((block) => str(object(block)?.text))
        .join("\n");

/** Where the session started in Buzz and for which agent, from its first
 * prompt's context; undefined when Buzz did not start it. */
export function buzzStart(entries: readonly Json[]) {
  const first = entries.find(
    (entry) => entry.type === "user" && !entry.isMeta && !entry.isSidechain,
  );
  const context = promptSections(
    promptText(object(first?.message)?.content),
  ).find((section) => section.tag === "context")?.body;
  const field = (name: string) =>
    context?.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1]?.trim();
  const channel = field("Channel");
  if (!channel) return undefined;
  const root = field("Session scope") === "thread" && field("Thread root");
  return {
    agent: field("Agent"),
    channelId: channel.match(/\(#([^)]+)\)$/)?.[1] ?? channel,
    ...(root ? { root } : {}),
  };
}

/** Each model request's usage once: Claude Code repeats a streamed
 * response's usage on every content block's line. */
function requests(entries: readonly Json[]) {
  const seen = new Map<string, { at: number; model: string; usage: Json }>();
  for (const entry of entries) {
    const message = object(entry.message);
    const usage = object(message?.usage);
    const model = str(message?.model);
    const at = Date.parse(str(entry.timestamp));
    if (entry.type !== "assistant" || !usage || !model || !at) continue;
    if (model === "<synthetic>") continue;
    const key = `${str(message?.id)}:${str(entry.requestId)}`;
    seen.set(key === ":" ? `${seen.size}` : key, { at, model, usage });
  }
  return [...seen.values()];
}

const COUNTS = {
  input: "input_tokens",
  output: "output_tokens",
  cacheRead: "cache_read_input_tokens",
  cacheWrite: "cache_creation_input_tokens",
} as const;

/** The requests' tokens by model and hour. */
function slices(entries: readonly Json[]): UsageSlice[] {
  type Slice = { hour: number; model: string; tokens: Record<string, number> };
  const byKey = new Map<string, Slice>();
  for (const { at, model, usage } of requests(entries)) {
    const hour = Math.floor(at / HOUR) * HOUR;
    const key = `${hour}:${model}`;
    const slice = byKey.get(key) ?? { hour, model, tokens: {} };
    byKey.set(key, slice);
    const counts = {
      ...Object.fromEntries(
        Object.entries(COUNTS).map(([name, field]) => [name, usage[field]]),
      ),
      cacheWrite1h: object(usage.cache_creation)?.ephemeral_1h_input_tokens,
    };
    for (const [name, raw] of Object.entries(counts)) {
      const value = count(raw);
      if (value !== undefined)
        slice.tokens[name] = (slice.tokens[name] ?? 0) + value;
    }
  }
  return [...byKey.values()];
}

/** A session file's usage, with its subagents' files, when Buzz started it for
 * `agent`. A saved session also counts when its prompt does not name an agent,
 * as prompts did before agents were named. */
export function sessionUsage(
  id: string,
  file: string,
  subagents: readonly string[],
  agent: string,
  saved: boolean,
): SessionUsage | undefined {
  const entries = lines(file);
  const start = buzzStart(entries);
  if (!start || (start.agent ? start.agent !== agent : !saved))
    return undefined;
  const all = [...entries, ...subagents.flatMap(lines)];
  const times = all
    .map((entry) => Date.parse(str(entry.timestamp)))
    .filter((at) => at > 0);
  if (!times.length) return undefined;
  let title: string | undefined;
  for (const entry of entries)
    if (entry.type === "ai-title" && str(entry.aiTitle).trim())
      title = str(entry.aiTitle).trim();
  return {
    id,
    channelId: start.channelId,
    ...(start.root ? { root: start.root } : {}),
    ...(title ? { title } : {}),
    startedAt: Math.min(...times),
    lastAt: Math.max(...times),
    usage: slices(all),
  };
}

/** The agent's Buzz sessions in its workspace's Claude Code history, active
 * since `since`. `saved` are the session ids this app saved for it. */
export async function readUsage(
  spawn: Spawn,
  workspace: string,
  agent: string,
  saved: readonly string[],
  since: number,
  signal: AbortSignal,
): Promise<SessionUsage[]> {
  const project = await workspaceProject(spawn, workspace, signal);
  if (!project) return [];
  const [named, sidechains] = await Promise.all([
    searchProject(spawn, project, `Agent: ${agent}`),
    searchProject(spawn, project, '"isSidechain":true'),
  ]);
  signal.throwIfAborted();
  const savedNames = new Set(
    saved.filter((id) => /^[\w-]+$/.test(id)).map((id) => `${id}.jsonl`),
  );
  const names = [
    ...new Set([
      ...savedNames,
      ...named.filter((name) => /^[^/]+\.jsonl$/.test(name)),
    ]),
  ];
  const subagents = new Map<string, string[]>();
  for (const path of sidechains) {
    const match = /^([\w-]+)\/subagents\/[^/]+\.jsonl$/.exec(path);
    if (match?.[1])
      subagents.set(match[1], [...(subagents.get(match[1]) ?? []), path]);
  }
  const read = async (path: string) => {
    try {
      return new TextDecoder().decode(
        // Project names start with `-`; GNU base64 would read one as options.
        await readFile(
          spawn,
          "~/.claude/projects",
          `./${project}/${path}`,
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
  const queue = [...names];
  const worker = async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      const file = await read(name);
      if (file === undefined) continue;
      const id = name.slice(0, -".jsonl".length);
      const files = await Promise.all((subagents.get(id) ?? []).map(read));
      const session = sessionUsage(
        id,
        file,
        files.filter((text) => text !== undefined),
        agent,
        savedNames.has(name),
      );
      if (session && session.lastAt >= since) found.push(session);
    }
  };
  await Promise.all(Array.from({ length: READERS }, worker));
  return found.sort((a, b) => b.lastAt - a.lastAt);
}
