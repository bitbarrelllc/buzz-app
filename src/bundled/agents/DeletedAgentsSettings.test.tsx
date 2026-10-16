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
