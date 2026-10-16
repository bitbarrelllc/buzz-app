// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createRelaySession } from "../../features/relay/session";
import type { RelaySession } from "../../features/relay/session";
import type { RelayData, RelaySnapshot } from "../../features/relay/service";
import type { Navigation } from "../../features/navigation/controller";
import { ChannelNavigationProvider } from "../../features/channel-navigation/ChannelNavigationState";
import { stubAvatarBrowserApis } from "../../features/agents/avatar-testing";
import { readView, writeView } from "../../shared/view-state";
import type { OpenTarget } from "../../features/navigation/targets";
import { NewMenu } from "../../app/shell/NewMenu";
import type { Agents } from "../../features/agents/service";
import { PrimarySidebar } from "../../app/shell/PrimarySidebar";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import { MeSidebar } from "./MeSidebar";
import { meTarget } from "./routes";

stubAvatarBrowserApis();
const owners: ReturnType<typeof createRelaySession>[] = [];
afterEach(() => {
  cleanup();
  for (const owner of owners.splice(0)) owner.dispose();
  localStorage.clear();
});
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const agent = "a".repeat(64);
const outsider = "b".repeat(64);
const viewer = "c".repeat(64);
const root = "d".repeat(64);
const scope = `https://relay.test:${viewer}`;
function fixture(combined = false, canCreate = false, agents?: Agents) {
  const owner = createRelaySession(null);
  owners.push(owner);
  const base = owner.session;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  let typing: ReturnType<RelaySession["typing"]["snapshot"]> = [];
  let activity: ReturnType<RelaySession["agentActivity"]["snapshot"]> = {
    ...base.agentActivity.snapshot(),
    status: "disabled",
  };
  let unread: ReturnType<RelaySession["unread"]["snapshot"]> = {
    target: { kind: "channel", channelId: id },
    observedCount: 2,
    attentionCount: 1,
    coverage: "observed",
    freshness: "observed",
    manual: "none",
  };
  let threads: ReturnType<RelaySession["unread"]["activity"]> = {
    channelId: id,
    items: [],
    coverage: "observed",
    freshness: "observed",
  };
  const markThrough = vi.fn(async () => ({
    operationId: "read",
    durability: "saved" as const,
    sync: "pending" as const,
  }));
  const list = {
    status: "ready" as const,
    channels: [
      { id, name: "Planning", channelType: "session" as const },
      { id: other, name: "Other", channelType: "session" as const },
    ],
  };
  const placement = {
    ...base.mePlacement.snapshot(),
    status: "ready" as const,
    entries: [
      {
        eventId: "e".repeat(64),
        createdAt: 1,
        record: {
          version: 2 as const,
          community: "https://relay.test",
          deleted: false,
          value: {
            type: "groups" as const,
            id: "me" as const,
            groups: [],
            assignments: {},
            channels: [id, other],
          },
        },
      },
    ],
  };
  const preferences = {
    status: "ready" as const,
    data: { sections: [], assignments: {}, starred: [], muted: [] },
  };
  const choices = {
    ...base.agentChoices.snapshot(),
    identities: [{ pubkey: agent, name: "Owned Agent", managed: true }],
  } satisfies ReturnType<RelaySession["agentChoices"]["snapshot"]>;
  const profiles = new Map([
    [agent, { name: "Owned Agent", isAgent: true as const }],
    [outsider, { name: "Outside Agent", isAgent: true as const }],
  ]);
  const session: RelaySession = {
    ...base,
    scope,
    viewer,
    channelCreation: { ...base.channelCreation, available: canCreate },
    channels: { ...base.channels, list: () => list, ensureList() {} },
    mePlacement: {
      ...base.mePlacement,
      snapshot: () => placement,
      ensure() {},
    },
    mePreferences: {
      ...base.mePreferences,
      sectionCreationWritable: canCreate,
      snapshot: () => preferences,
      ensure: async () => {},
    },
    typing: { ...base.typing, snapshot: () => typing, subscribe },
    agentActivity: {
      ...base.agentActivity,
      snapshot: () => activity,
      subscribe,
      subscribeWorking: subscribe,
      workingSnapshot: () =>
        JSON.stringify(
          activity.turns
            .filter((turn) => turn.state === "working")
            .map((turn) => turn.channelId),
        ),
    },
    agentChoices: { ...base.agentChoices, snapshot: () => choices },
    profiles: { ...base.profiles, snapshot: () => profiles },
    unread: {
      ...base.unread,
      snapshot: () => unread,
      subscribe: (_target, listener) => subscribe(listener),
      activity: () => threads,
      subscribeActivity: (_id, listener) => subscribe(listener),
      markThrough,
    },
  };
  let snapshot: RelaySnapshot = {
    status: "ready",
    session,
    generation: 1,
    scope,
  };
  const relay: RelayData = {
    snapshot: () => snapshot,
    subscribe,
    retry() {},
    disconnect() {},
    async clearCache() {},
  };
  let attempt = 0;
  const open = vi.fn(async (next: OpenTarget) => {
    target = next;
    attempt++;
    rendered.rerender(tree());
    publish();
    return { status: "opened" as const };
  });
  const navigator = {
    open,
    subscribe,
    snapshot: () => ({
      attempt: { id: String(attempt), signal: new AbortController().signal },
    }),
  } as unknown as Navigation;
  let target: OpenTarget = meTarget(scope, other);
  let sidebarVisible = true;
  let meEnabled = true;
  const publish = () => {
    for (const listener of listeners) listener();
  };
  const tree = () => (
    <ChannelNavigationProvider relay={relay}>
      <ToastProvider>
        {combined ? (
          <>
            <NewMenu
              relay={relay}
              navigator={navigator}
              agents={agents}
              meEnabled={meEnabled}
            />
            {sidebarVisible && (
              <PrimarySidebar
                relay={relay}
                navigator={navigator}
                target={target}
                meEnabled={meEnabled}
                sessionsEnabled
              >
                <button type="button">Inbox</button>
              </PrimarySidebar>
            )}
          </>
        ) : (
          <MeSidebar relay={relay} navigator={navigator} target={target} />
        )}
      </ToastProvider>
    </ChannelNavigationProvider>
  );
  const rendered = render(tree());
  return {
    session,
    navigate(next: OpenTarget) {
      target = next;
      rendered.rerender(tree());
    },
    sidebar(visible: boolean) {
      sidebarVisible = visible;
      rendered.rerender(tree());
    },
    meEnabled(enabled: boolean) {
      meEnabled = enabled;
      rendered.rerender(tree());
    },
    connection(change: Partial<RelaySnapshot>) {
      act(() => {
        snapshot = { ...snapshot, ...change };
        publish();
      });
    },
    replaceSession() {
      act(() => {
        snapshot = { ...snapshot, session: { ...session }, generation: 2 };
        publish();
      });
    },
    open,
    markThrough,
    listeners,
    typing(next: typeof typing) {
      act(() => {
        typing = next;
        publish();
      });
    },
    activity(next: typeof activity) {
      act(() => {
        activity = next;
        publish();
      });
    },
    threads(next: typeof threads) {
      act(() => {
        threads = next;
        publish();
      });
    },
    clearUnread() {
      act(() => {
        unread = { ...unread, observedCount: 0, attentionCount: 0 };
        publish();
      });
    },
    activitySnapshot: activity,
  };
}
it("keeps unread state while owned thread typing and observer working signals start and stop", () => {
  const f = fixture();
  expect(screen.queryByRole("img", { name: "Berd" })).not.toBeInTheDocument();
  const row = screen.getByRole("button", { name: /^Planning/ });
  expect(
    row.querySelector('[data-channel-unread-title="true"]'),
  ).toBeInTheDocument();
  expect(row.querySelector("[data-channel-priority]")).toBeInTheDocument();
  f.typing([{ channelId: id, threadRootId: root, pubkey: outsider }]);
  expect(within(row).queryByRole("img", { name: /working/ })).toBeNull();
  f.typing([{ channelId: other, pubkey: agent }]);
  expect(within(row).queryByRole("img", { name: /working/ })).toBeNull();
  f.typing([{ channelId: id, threadRootId: root, pubkey: agent }]);
  expect(
    within(row).getByRole("img", { name: "Owned Agent working in Planning" }),
  ).toBeInTheDocument();
  expect(row.querySelector("[data-channel-priority]")).toBeInTheDocument();
  expect(row).toHaveAccessibleName(/observed unread messages/);
  expect(row).toHaveAccessibleName(/Owned Agent working in Planning/);
  f.activity({
    ...f.activitySnapshot,
    status: "listening",
    turns: [
      {
        channelId: id,
        agent,
        turnId: "one",
        timestamp: Date.now(),
        state: "working",
      },
    ],
  });
  expect(row.querySelectorAll("[data-channel-working]")).toHaveLength(1);
  f.typing([]);
  expect(within(row).getByRole("img", { name: /working/ })).toBeInTheDocument();
  f.activity(f.activitySnapshot);
  expect(within(row).queryByRole("img", { name: /working/ })).toBeNull();
  expect(row.querySelector("[data-channel-priority]")).toBeInTheDocument();
  f.clearUnread();
  expect(row.querySelector("[data-channel-unread]")).toBeNull();
  cleanup();
  expect(f.listeners.size).toBe(0);
});
it("offers unread thread navigation and mark-read through the shared activity popover", async () => {
  const f = fixture();
  const user = userEvent.setup();
  f.threads({
    channelId: id,
    items: [
      {
        channelId: id,
        rootId: root,
        latestMessageId: "e".repeat(64),
        authorId: agent,
        preview: "Needs review",
        unreadCount: 1,
        createdAt: 1,
      },
    ],
    coverage: "observed",
    freshness: "observed",
  });
  const row = screen.getByRole("button", { name: /^Planning/ });
  row.focus();
  await user.keyboard("{Enter}");
  const popup = screen.getByRole("dialog", { name: "Activity in Planning" });
  await user.click(
    within(popup).getByRole("button", {
      name: "Mark thread from Owned Agent as read",
    }),
  );
  expect(f.markThrough).toHaveBeenCalledWith(
    { kind: "thread", channelId: id, rootId: root },
    "e".repeat(64),
  );
  await user.click(
    within(popup).getByRole("button", {
      name: "Open unread thread from Owned Agent: Needs review",
    }),
  );
  expect(f.open).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: "conversation",
      channelId: id,
      messageId: root,
    }),
  );
});
it("opens a typing-only agent's profile activity in its Me conversation", async () => {
  const f = fixture();
  f.typing([{ channelId: id, pubkey: agent }]);
  const user = userEvent.setup();
  screen.getByRole("button", { name: /^Planning/ }).focus();
  await user.keyboard("{Enter}");
  let popup = screen.getByRole("dialog", { name: "Activity in Planning" });
  await user.click(
    within(popup).getByRole("button", { name: "View Owned Agent activity" }),
  );
  expect(f.open).toHaveBeenLastCalledWith(meTarget(scope, id));
  screen.getByRole("button", { name: /^Planning/ }).focus();
  await user.keyboard("{Enter}");
  popup = screen.getByRole("dialog", { name: "Activity in Planning" });
  await user.click(
    within(popup).getByRole("button", {
      name: "Open conversation for Owned Agent in Planning",
    }),
  );
  expect(f.open).toHaveBeenLastCalledWith(meTarget(scope, id));
});

it.each(["disconnected", "connecting", "error"] as const)(
  "keeps Solo's brand visible while %s without offering unavailable chat creation",
  (status) => {
    const owner = createRelaySession(null);
    owners.push(owner);
    const snapshot = { status, generation: 1, scope, session: owner.session };
    const relay: RelayData = {
      snapshot: () => snapshot,
      subscribe: () => () => {},
      retry() {},
      disconnect() {},
      async clearCache() {},
    };
    // No navigation is needed until the connected history is mounted.
    const navigator = { open: vi.fn() } as unknown as Navigation;
    render(
      <MeSidebar
        relay={relay}
        navigator={navigator}
        target={meTarget(scope)}
      />,
    );
    const sidebar = screen.getByRole("region", { name: "Solo" });
    expect(
      within(sidebar).queryByRole("img", { name: "Berd" }),
    ).not.toBeInTheDocument();
    expect(within(sidebar).getByRole("status")).toHaveTextContent(
      "Connect to a community",
    );
    expect(
      within(sidebar).queryByRole("button", { name: "New chat" }),
    ).toBeNull();
  },
);

it("filters the combined sidebar without navigating or resetting Solo sections", async () => {
  const user = userEvent.setup();
  const f = fixture(true);
  const all = screen.getByRole("tab", { name: "All" });
  const solo = screen.getByRole("tab", { name: "Solo" });
  const multiplayer = screen.getByRole("tab", { name: "Team" });
  expect(all).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: "New" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Inbox" })).toBeVisible();
  expect(
    screen.getAllByRole("separator", { name: "Resize sidebar" }),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Chats" }));
  await user.click(multiplayer);
  expect(
    screen.queryByRole("button", { name: "New chat" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Inbox" })).toBeVisible();
  expect(screen.getByRole("tabpanel", { name: "Team" })).toHaveAttribute(
    "id",
    multiplayer.getAttribute("aria-controls"),
  );
  await user.click(solo);
  expect(screen.getByRole("button", { name: "Inbox" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Chats" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await user.keyboard("{ArrowRight}");
  expect(multiplayer).toHaveFocus();
  expect(solo).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Enter}");
  expect(multiplayer).toHaveAttribute("aria-selected", "true");
  await user.click(all);
  expect(f.open).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "New" }));
  expect(
    (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
  ).toEqual(["New chat", "New project", "New DM", "New channel"]);
  await user.click(screen.getByRole("menuitem", { name: "New chat" }));
  expect(f.open).toHaveBeenCalledWith(meTarget(scope, "new", undefined));
});

it("opens the direct message composer from New even in the Solo filter", async () => {
  const user = userEvent.setup();
  const f = fixture(true);
  await user.click(screen.getByRole("tab", { name: "Solo" }));
  await user.click(screen.getByRole("button", { name: "New" }));
  await user.click(await screen.findByRole("menuitem", { name: "New DM" }));
  expect(f.open).toHaveBeenCalledWith({
    version: 1,
    kind: "page",
    pluginId: "buzz.channels",
    pageId: "channels",
    scope: { viewer, communityOrigin: "https://relay.test" },
    route: { version: 1, params: "new-message" },
  });
});

it.each([
  ["New project", "New project", "Cancel"],
  ["New channel", "Create a channel", "Close channel creation"],
])(
  "opens %s from any filter and returns focus to New on cancel",
  async (item, title, close) => {
    const user = userEvent.setup();
    fixture(true, true);
    await user.click(screen.getByRole("tab", { name: "Team" }));
    const trigger = screen.getByRole("button", { name: "New" });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: item }));
    const dialog = await screen.findByRole("dialog", { name: title });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("textbox", { name: "Name" }),
      ).toHaveFocus(),
    );
    await user.click(within(dialog).getByRole("button", { name: close }));
    await waitFor(() => expect(trigger).toHaveFocus());
  },
);

it("keeps unavailable creation actions disabled", async () => {
  const user = userEvent.setup();
  fixture(true);
  await user.click(screen.getByRole("button", { name: "New" }));
  expect(
    await screen.findByRole("menuitem", { name: "New project" }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("menuitem", { name: "New channel" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

it("does not navigate to a replaced session after project creation completes", async () => {
  const f = fixture(true, true);
  const user = userEvent.setup();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const create = vi
    .spyOn(f.session.mePreferences, "createSection")
    .mockReturnValue(pending);
  await user.click(screen.getByRole("button", { name: "New" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "New project" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "New project" });
  await user.type(
    within(dialog).getByRole("textbox", { name: "Name" }),
    "Planning",
  );
  try {
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    f.replaceSession();
  } finally {
    await act(async () => {
      finish();
      await pending;
    });
  }
  expect(f.open).not.toHaveBeenCalled();
});

it("retains scope across Settings remounts and reveals navigation outside the filter", async () => {
  const f = fixture(true);
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "Team" }));
  f.sidebar(false);
  f.sidebar(true);
  expect(screen.getByRole("tab", { name: "Team" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  f.navigate(meTarget(scope, "new"));
  expect(screen.getByRole("tab", { name: "Solo" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  f.navigate({
    version: 1,
    kind: "conversation",
    channelId: "team-channel",
    scope: { viewer, communityOrigin: "https://relay.test" },
  });
  expect(screen.getByRole("tab", { name: "Team" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.click(screen.getByRole("tab", { name: "All" }));
  f.navigate(meTarget(scope, id));
  expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

it("omits the scope switcher and Solo creation when Solo is disabled", async () => {
  const user = userEvent.setup();
  const f = fixture(true);
  f.meEnabled(false);
  expect(
    screen.queryByRole("tablist", { name: "Navigation scope" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "New" }));
  expect(
    (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
  ).toEqual(["New DM", "New channel"]);
});

it.each([
  ["New project", "New project"],
  ["New channel", "Create a channel"],
])(
  "retains typed %s input through cached reconnect and session replacement",
  async (item, title) => {
    const f = fixture(true, true);
    const user = userEvent.setup();
    f.connection({ status: "connecting", cached: true });
    await user.click(screen.getByRole("button", { name: "New" }));
    await user.click(await screen.findByRole("menuitem", { name: item }));
    const input = within(
      await screen.findByRole("dialog", { name: title }),
    ).getByRole("textbox", { name: "Name" });
    await user.type(input, "Keep this draft");
    f.connection({ status: "error" });
    expect(input).toHaveValue("Keep this draft");
    f.replaceSession();
    expect(
      within(screen.getByRole("dialog", { name: title })).getByRole("textbox", {
        name: "Name",
      }),
    ).toHaveValue("Keep this draft");
  },
);

it("keeps navigation scope preferences partitioned by community", async () => {
  const f = fixture(true);
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "Team" }));
  const second = `https://second.test:${viewer}`;
  f.connection({ scope: second, session: { ...f.session, scope: second } });
  expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.click(screen.getByRole("tab", { name: "Solo" }));
  f.connection({ scope, session: f.session });
  expect(screen.getByRole("tab", { name: "Team" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

it("header channel creation expands the saved destination without changing other collapsed sections", async () => {
  writeView(scope, "channel-sidebar", {
    collapsed: ["channels", "starred"],
    width: 280,
  });
  const f = fixture(true, true);
  const create = vi
    .spyOn(f.session.channelCreation, "create")
    .mockResolvedValue("new-channel");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "New channel" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Create a channel",
  });
  await user.type(
    within(dialog).getByRole("textbox", { name: "Name" }),
    "Planning",
  );
  await user.click(
    within(dialog).getByRole("button", { name: /^Create channel$/ }),
  );
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(f.open).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "conversation",
        channelId: "new-channel",
      }),
    ),
  );
  expect(readView(scope, "channel-sidebar", null)).toMatchObject({
    collapsed: ["starred"],
    width: 280,
  });
});

it("reveals Solo when New chat reopens the same destination after filtering it out", async () => {
  const f = fixture(true);
  const user = userEvent.setup();
  f.navigate(meTarget(scope));
  await user.click(screen.getByRole("tab", { name: "Team" }));
  expect(screen.getByRole("tab", { name: "Team" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "New" }));
  await user.click(await screen.findByRole("menuitem", { name: "New chat" }));
  expect(screen.getByRole("tab", { name: "Solo" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
