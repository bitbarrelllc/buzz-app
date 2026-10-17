// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Agent, AgentsSnapshot } from "../../features/agents/service";
import { DeletedAgentsSettings } from "./DeletedAgentsSettings";

afterEach(cleanup);

const agent = (name: string, lifecycle?: Agent["lifecycle"]) =>
  ({
    pubkey: name,
    name,
    type: "goose",
    owner: "o",
    relay: "wss://r",
    place: "here",
    attention: {},
    skipped: {},
    timers: {},
    attentionEnabled: false,
    config: {},
    ...(lifecycle ? { lifecycle } : {}),
  }) as Agent;

function fake(running: Agent[], recover = vi.fn(async () => {})) {
  const state = {
    status: "ready",
    classifier: "unavailable",
    classifierKey: "missing",
    agents: [],
    running,
    teams: [],
  } as AgentsSnapshot;
  return { snapshot: () => state, subscribe: () => () => {}, recover };
}

it("lists only deleted agents and recovers an archived one", async () => {
  const agents = fake([
    agent("Live"),
    agent("Gone", "archived"),
    agent("Leaving", "archiving"),
  ]);
  render(<DeletedAgentsSettings agents={agents} active={() => true} />);
  expect(screen.queryByText("Live")).toBeNull();
  expect(screen.getByText(/Deleting…/)).toBeInTheDocument();
  const buttons = screen.getAllByRole("button", { name: "Recover" });
  expect(buttons).toHaveLength(1);
  await userEvent.click(buttons[0] as HTMLElement);
  expect(agents.recover).toHaveBeenCalledWith("Gone");
});

it("shows why a recovery did not finish", async () => {
  const agents = fake(
    [agent("Gone", "archived")],
    vi.fn(async () => {
      throw new Error("Gone isn't recovered yet");
    }),
  );
  render(<DeletedAgentsSettings agents={agents} active={() => true} />);
  await userEvent.click(screen.getByRole("button", { name: "Recover" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Gone isn't recovered yet",
  );
});

/** Agents whose Recover moves the row to `recovering`, then settles it. */
function recovering(succeeds: boolean) {
  let state = {
    status: "ready",
    classifier: "unavailable",
    classifierKey: "missing",
    agents: [],
    running: [agent("Gone", "archived")],
    teams: [],
  } as AgentsSnapshot;
  const listeners = new Set<() => void>();
  const set = (running: Agent[]) => {
    state = { ...state, running };
    for (const listener of listeners) listener();
  };
  let finish!: () => void;
  const recover = vi.fn(async () => {
    set([agent("Gone", "recovering")]);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (succeeds) return set([]);
    set([agent("Gone", "archived")]);
    throw new Error("Gone isn't recovered yet");
  });
  return {
    agents: {
      snapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      recover,
    },
    finish: () => finish(),
  };
}

it("keeps keyboard focus on Recover while it runs and after it is refused", async () => {
  const { agents, finish } = recovering(false);
  render(<DeletedAgentsSettings agents={agents} active={() => true} />);
  screen.getByRole("button", { name: "Recover" }).focus();
  await userEvent.keyboard("{Enter}");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: /Recover/ }),
  );
  finish();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Recover" }),
  );
});

it("moves focus to the list's heading once a recovered agent leaves it", async () => {
  const { agents, finish } = recovering(true);
  render(<DeletedAgentsSettings agents={agents} active={() => true} />);
  screen.getByRole("button", { name: "Recover" }).focus();
  await userEvent.keyboard("{Enter}");
  finish();
  expect(await screen.findByText("No deleted agents.")).toBeInTheDocument();
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Deleted agents" }),
  );
});
