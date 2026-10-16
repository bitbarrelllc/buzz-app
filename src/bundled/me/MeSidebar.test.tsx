// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createRelaySession } from "../../features/relay/session";
import type { RelayData } from "../../features/relay/service";
import type { Navigation } from "../../features/navigation/controller";
import { stubAvatarBrowserApis } from "../../features/agents/avatar-testing";
import { MeSidebar } from "./MeSidebar";
import { meTarget } from "./routes";

import {
  fixture,
  owners,
  id,
  other,
  agent,
  outsider,
  root,
  scope,
} from "../../app/shell/sidebar-testing";
stubAvatarBrowserApis();
afterEach(() => {
  cleanup();
  for (const owner of owners.splice(0)) owner.dispose();
  localStorage.clear();
});
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
  "shows Solo's connection state while %s",
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
