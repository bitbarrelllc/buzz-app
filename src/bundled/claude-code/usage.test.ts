import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { HostProcessOptions } from "../../features/host/service";
import manifest from "./manifest.json";
import { readUsage, sessionUsage } from "./usage";

const agent = "a".repeat(64);
const other = "b".repeat(64);
const root = "c".repeat(64);
const HOUR = 3_600_000;
const at = (ms: number) =>
  new Date(Date.UTC(2026, 9, 16, 9) + ms).toISOString();
const context = (lines: string[]) =>
  JSON.stringify({
    type: "user",
    timestamp: at(0),
    message: {
      role: "user",
      content: `<context>\n${lines.join("\n")}\n</context>\n\n<buzz-event type="mention">\nContent: hi\n</buzz-event>`,
    },
  });
const threadPrompt = (who = agent) =>
  context([
    "Scope: thread",
    "Session scope: thread",
    "Channel: buzz-app (#chan)",
    `Thread root: ${root}`,
    `Agent: ${who}`,
  ]);
const reply = (
  ms: number,
  id: string,
  usage: Record<string, unknown>,
  model = "claude-opus-5-5",
  extra = {},
) =>
  JSON.stringify({
    type: "assistant",
    timestamp: at(ms),
    requestId: `req-${id}`,
    message: { id, model, role: "assistant", content: [], usage },
    ...extra,
  });
const usage = (input: number, output: number, read = 0, write = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
});
const hourWrites = (counts: ReturnType<typeof usage>, hour: number) => ({
  ...counts,
  cache_creation: {
    ephemeral_1h_input_tokens: hour,
    ephemeral_5m_input_tokens: counts.cache_creation_input_tokens - hour,
  },
});

it("counts each streamed request once, by model and hour, with its subagents", () => {
  const file = [
    threadPrompt(),
    // Claude Code repeats a response's usage on each content block's line.
    reply(1000, "m1", hourWrites(usage(2, 10, 100, 50), 40)),
    reply(1001, "m1", hourWrites(usage(2, 10, 100, 50), 40)),
    reply(2000, "m2", usage(3, 20, 200, 0)),
    reply(HOUR + 5, "m3", usage(1, 5, 300, 0), "claude-sonnet-5-5"),
    reply(HOUR + 6, "m4", usage(9, 9), "<synthetic>"),
    JSON.stringify({ type: "ai-title", aiTitle: "Port the scroll patch" }),
  ].join("\n");
  const subagent = reply(1500, "s1", usage(4, 40, 400, 0), "claude-haiku-5-5", {
    isSidechain: true,
  });
  const session = sessionUsage(
    "s",
    `${file}\n{"partial`,
    [subagent],
    agent,
    false,
  );
  const hour = Date.UTC(2026, 9, 16, 9);
  expect(session).toEqual({
    id: "s",
    channelId: "chan",
    root,
    title: "Port the scroll patch",
    startedAt: hour,
    lastAt: hour + HOUR + 6,
    usage: [
      {
        hour,
        model: "claude-opus-5-5",
        tokens: {
          input: 5,
          output: 30,
          cacheRead: 300,
          cacheWrite: 50,
          cacheWrite1h: 40,
        },
      },
      {
        hour: hour + HOUR,
        model: "claude-sonnet-5-5",
        tokens: { input: 1, output: 5, cacheRead: 300, cacheWrite: 0 },
      },
      {
        hour,
        model: "claude-haiku-5-5",
        tokens: { input: 4, output: 40, cacheRead: 400, cacheWrite: 0 },
      },
    ],
  });
});

it("keeps only sessions Buzz started for this agent", () => {
  const channelPrompt = context([
    "Scope: channel",
    "Session scope: channel",
    "Channel: chan",
  ]);
  const work = reply(1000, "m1", usage(1, 1));
  expect(
    sessionUsage("s", `${threadPrompt(other)}\n${work}`, [], agent, true),
  ).toBeUndefined();
  // Not a Buzz prompt: the person's own session in the same workspace.
  expect(
    sessionUsage(
      "s",
      `${JSON.stringify({ type: "user", timestamp: at(0), message: { content: "hi" } })}\n${work}`,
      [],
      agent,
      true,
    ),
  ).toBeUndefined();
  // Prompts from before agents were named count only when saved for it.
  expect(
    sessionUsage("s", `${channelPrompt}\n${work}`, [], agent, false),
  ).toBeUndefined();
  expect(
    sessionUsage("s", `${channelPrompt}\n${work}`, [], agent, true),
  ).toMatchObject({
    channelId: "chan",
  });
  expect(
    sessionUsage("s", `${channelPrompt}\n${work}`, [], agent, true),
  ).not.toHaveProperty("root");
});

let home: string | undefined;
afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
  home = undefined;
});

it("finds the agent's sessions with the manifest's processes", async () => {
  home = mkdtempSync(join(tmpdir(), "claude-usage-"));
  const project = join(home, ".claude/projects/-Users-me--buzz");
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), content);
  };
  const recent = Date.UTC(2026, 9, 16, 9);
  write("named.jsonl", `${threadPrompt()}\n${reply(1000, "m1", usage(1, 2))}`);
  write(
    "named/subagents/agent-x.jsonl",
    reply(1500, "s1", usage(3, 4), "claude-opus-5-5", { isSidechain: true }),
  );
  write(
    "theirs.jsonl",
    `${threadPrompt(other)}\n${reply(1000, "m1", usage(1, 2))}`,
  );
  write(
    "saved.jsonl",
    `${context(["Session scope: channel", "Channel: dm"])}\n${reply(1000, "m1", usage(5, 6))}`,
  );
  const sessions = await readUsage(
    processes(home),
    "~/.buzz",
    agent,
    ["saved", "gone"],
    recent - HOUR,
    new AbortController().signal,
  );
  expect(sessions.map((session) => session.id).sort()).toEqual([
    "named",
    "saved",
  ]);
  expect(sessions.find((session) => session.id === "named")?.usage).toEqual([
    {
      hour: recent,
      model: "claude-opus-5-5",
      tokens: { input: 4, output: 6, cacheRead: 0, cacheWrite: 0 },
    },
  ]);
  // Activity before `since` is left out.
  expect(
    await readUsage(
      processes(home),
      "~/.buzz",
      agent,
      [],
      recent + 2 * HOUR,
      new AbortController().signal,
    ),
  ).toEqual([]);
});

/** Runs the manifest's processes for real, `~` being `home`; the workspace
 * resolves to /Users/me/.buzz. */
function processes(home: string) {
  return async (id: string, options: HostProcessOptions = {}) => {
    const declared = manifest.host.processes.find(
      (process) => process.id === id,
    );
    if (!declared) throw new Error(`undeclared process ${id}`);
    if (id === "workspace") options.onStdout?.("/Users/me/.buzz\n");
    const exited =
      id === "workspace"
        ? Promise.resolve(0)
        : new Promise<number>((resolve) => {
            const child = execFile(
              declared.program,
              [...(declared.args ?? []), ...(options.args ?? [])],
              { cwd: options.cwd?.replace(/^~/, home), maxBuffer: 1 << 26 },
              (error) => resolve(error ? Number(error.code) || 1 : 0),
            );
            child.stdout?.on("data", (data) =>
              options.onStdout?.(String(data)),
            );
            child.stderr?.on("data", (data) =>
              options.onStderr?.(String(data)),
            );
          });
    return {
      write: async () => undefined,
      end: async () => undefined,
      kill: async () => undefined,
      exited,
    };
  };
}
