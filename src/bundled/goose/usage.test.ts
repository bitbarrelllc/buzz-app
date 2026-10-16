import { expect, it } from "vitest";
import type { EventData } from "../../features/relay/events";
import { turnPrompt } from "../claude-code/prompt";
import { type FakeSession, fakeSpawn } from "./goose-testing";
import { GooseHistory } from "./transcript";
import { readUsage, sessionUsage } from "./usage";

const agent = "c".repeat(64);
const other = "d".repeat(64);
const HOUR = 3_600_000;
const start = 1_800_000_000;
const mention = {
  id: "1".repeat(64),
  pubkey: "a".repeat(64),
  kind: 9,
  created_at: start,
  content: "@Grok fix the build",
  tags: [["h", "chan"]],
  sig: "",
} as EventData;
const ask = (pubkey = agent) =>
  turnPrompt({
    agent: pubkey,
    event: mention,
    channel: { id: "chan", name: "general" },
    scope: "thread",
    context: [],
    total: 1,
    label: "@mention",
    name: () => undefined,
  });
const user = (text: string, created = start, userVisible = true) => ({
  role: "user",
  created,
  content: [{ type: "text", text }],
  metadata: { userVisible },
});
const reply = (
  created: number,
  usage: Record<string, unknown>,
  requestedModel = "databricks-claude-sonnet-5-5",
) => ({
  role: "assistant",
  created,
  content: [{ type: "text", text: "Done." }],
  metadata: {
    userVisible: true,
    inference: { requestedModel, resolvedModel: `system.ai.${requestedModel}` },
    usage,
  },
});
// goose's input counts the cached prompt tokens too.
const tokens = (input: number, read: number, write: number, cost?: number) => ({
  inputTokens: input + read + write,
  outputTokens: 10,
  cacheReadTokens: read,
  cacheWriteTokens: write,
  ...(cost === undefined ? {} : { cost, costSource: "estimated" }),
});

it("counts each reply's tokens and goose's price, by model and hour", () => {
  const session = sessionUsage("s", [
    user(ask()),
    user("<turn-context>…</turn-context>", start, false),
    reply(start + 1, tokens(4, 0, 100, 0.06)),
    reply(start + 2, tokens(2, 100, 5, 0.01)),
    // An unpriced reply leaves its slice to be priced from tokens.
    reply(start + 3600, tokens(1, 50, 0)),
    reply(start + 3601, tokens(1, 50, 0, 0.02)),
  ]);
  const hour = Math.floor((start * 1000) / HOUR) * HOUR;
  expect(session).toEqual({
    id: "s",
    channelId: "chan",
    root: mention.id,
    title: "@Grok fix the build",
    startedAt: start * 1000,
    lastAt: (start + 3601) * 1000,
    usage: [
      {
        hour,
        model: "databricks-claude-sonnet-5-5",
        tokens: { input: 6, output: 20, cacheRead: 100, cacheWrite: 105 },
        costUsd: expect.closeTo(0.07),
      },
      {
        hour: hour + HOUR,
        model: "databricks-claude-sonnet-5-5",
        tokens: { input: 2, output: 20, cacheRead: 100, cacheWrite: 0 },
      },
    ],
  });
  // Not a Buzz prompt: the person's own goose session.
  expect(sessionUsage("s", [user("hi"), reply(start, tokens(1, 0, 0))])).toBe(
    undefined,
  );
});

it("reads the agent's sessions in its workspace through goose", async () => {
  const saved = (
    sessionId: string,
    conversation: Record<string, unknown>[],
    updatedAt = "2027-01-15T08:00:00Z",
  ): FakeSession => ({
    sessionId,
    title: `Grok · #general · ${sessionId}`,
    cwd: "/home/test/.buzz",
    updatedAt,
    conversation,
  });
  const work = reply(start + 1, tokens(1, 2, 3, 0.5));
  const history = new GooseHistory(
    fakeSpawn({
      home: "/home/test",
      history: [
        saved("mine", [user(ask()), work]),
        // Another agent's session that mentions this one.
        saved("theirs", [user(ask(other)), user(`Ask ${agent}`), work]),
        saved("old", [user(ask()), work], "2026-01-01T00:00:00Z"),
      ],
    }).spawn,
  );
  const sessions = await readUsage(
    history,
    agent,
    "~/.buzz",
    Date.parse("2026-06-01T00:00:00Z"),
    new AbortController().signal,
  );
  expect(sessions.map((session) => session.id)).toEqual(["mine"]);
  expect(sessions[0]?.usage[0]).toMatchObject({
    tokens: { input: 1, cacheRead: 2, cacheWrite: 3 },
    costUsd: 0.5,
  });
});
