// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationHostServices } from "../../features/conversation/ConversationHost";
import type { ConversationExtensions } from "../../features/conversation/contracts";
import { setThreadPlacementPreference } from "../../features/messages/thread-preferences";
import type { RelaySession } from "../../features/relay/session";
import type { ConversationTab as Tab } from "./useChannelTabState";
import { PageTabs, type PageTabTarget } from "./PageTabs";

// The tab's own conversation has its mounted suite; this owner places it.
vi.mock("./ConversationTab", () => ({
  ConversationTab: ({
    tab,
    channel,
  }: {
    tab: Tab;
    channel: { name: string };
  }) => (
    <p>
      {tab.kind} in {channel.name}
    </p>
  ),
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function fixture() {
  const channels = [
    { id: "alpha", name: "alpha" },
    { id: "beta", name: "beta" },
    { id: "pending", name: "pending", cached: true },
  ];
  const list = { channels };
  const rows = { rows: [{ id: "root", content: "Root text" }] };
  const profiles = new Map();
  const available: never[] = [];
  const session = {
    viewer: "viewer",
    channels: {
      ensureList: () => () => {},
      subscribeList: () => () => {},
      list: () => list,
      window: () => rows,
    },
    profiles: { snapshot: () => profiles, subscribe: () => () => {} },
  } as unknown as RelaySession;
  const connection = { status: "ready", session };
  const host = {
    relay: { snapshot: () => connection },
    panels: {
      snapshot: () => available,
      subscribe: () => () => {},
      resolve: () => undefined,
    },
    navigation: { open: vi.fn() },
  } as unknown as ConversationHostServices;
  let open: (target: PageTabTarget) => boolean = () => false;
  const openers = new Set<typeof open>();
  render(
    <PageTabs
      id="switchboard"
      session={session}
      scope="origin:viewer"
      label="Switchboard"
      host={host}
      extensions={{} as ConversationExtensions}
    >
      {(next) => {
        open = next;
        openers.add(next);
        return <p>Session list</p>;
      }}
    </PageTabs>,
  );
  return {
    openers,
    open(target: PageTabTarget) {
      let opened = false;
      act(() => {
        opened = open(target);
      });
      return opened;
    },
  };
}
const tabs = (name: string) =>
  within(screen.getByRole("tablist", { name }))
    .getAllByRole("tab")
    .map((tab) => tab.textContent);

it("opens threads beside the page's own tab in the preferred pane", () => {
  setThreadPlacementPreference("main");
  const page = fixture();
  expect(screen.getByText("Session list")).toBeVisible();
  expect(page.open({ channelId: "alpha", threadId: "root" })).toBe(true);
  expect(tabs("Switchboard tabs")).toEqual(["Switchboard", "Root text"]);
  expect(screen.getByText("thread in alpha")).toBeVisible();
});

it("opens whole conversations as side tabs and refuses unknown ones", () => {
  setThreadPlacementPreference("side");
  const page = fixture();
  expect(page.open({ channelId: "missing" })).toBe(false);
  // Membership a cached channel has not confirmed cannot show a tab.
  expect(page.open({ channelId: "pending" })).toBe(false);
  expect(page.open({ channelId: "beta" })).toBe(true);
  expect(page.open({ channelId: "alpha", threadId: "root" })).toBe(true);
  expect(screen.getAllByRole("tablist")).toHaveLength(2);
  const side = screen
    .getAllByRole("tablist")
    .find((list) => list.getAttribute("aria-label") !== "Switchboard tabs");
  expect(
    within(side as HTMLElement)
      .getAllByRole("tab")
      .map((tab) => tab.textContent),
  ).toEqual(["beta", "Root text"]);
  // Opening the same conversation again selects its tab.
  expect(page.open({ channelId: "beta" })).toBe(true);
  expect(screen.getByText("conversation in beta")).toBeVisible();
  // Pages can depend on one opener across the renders its tabs cause.
  expect(page.openers.size).toBe(1);
});
