// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { FolderSimpleIcon, GlobeIcon } from "../shared/design-system/icons";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Context } from "@deepseek-ai/cordis";
import { afterEach, expect, it, vi } from "vitest";
import { createCommunityMembership } from "../bundled/moderation/membership";
import {
  SettingsCardsService,
  type SettingsCard,
  type SettingsCards,
} from "../features/settings/service";
import type { RelayData } from "../features/relay/service";
import type { Contribution } from "../plugins/contributions";

afterEach(cleanup);
vi.mock("../bundled/icons", () => ({
  bundledIcons: new Map([
    ["buzz.channels", "/channels-icon.png"],
    ["example.helper", "/bundled-helper-icon.png"],
  ]),
}));
vi.mock("../bundled/readmes", () => ({
  bundledReadmes: new Map([
    [
      "buzz.channels",
      "# Channels\n\nHold conversations.\n\n## Getting started\n\n- Read [the spec](../mentions/README.md) or [the site](https://example.com).\n- <b>Raw</b> markup is dropped.\n",
    ],
    ["example.helper", "# Helper\n\nNot from Buzz.\n"],
  ]),
}));

function registry(initial: Contribution<SettingsCard>[]) {
  let entries: readonly Contribution<SettingsCard>[] = initial;
  const listeners = new Set<() => void>();
  const cards: SettingsCards = {
    snapshot: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    register() {},
    retainVisibility: () => () => {},
    has: (key) => entries.some((entry) => entry.key === key),
    visibility: (key) => entries.some((entry) => entry.key === key),
  };
  return {
    cards,
    set(next: Contribution<SettingsCard>[]) {
      entries = next;
      for (const listener of listeners) listener();
    },
  };
}
const card = (
  id: string,
  title: string,
  group?: string,
  section?: "administration",
): Contribution<SettingsCard> =>
  Object.freeze({
    id,
    title,
    ...(group ? { group } : {}),
    ...(section ? { section } : {}),
    key: `example/${id}`,
    pluginId: "example",
    revision: "one",
    component: ({ community }) => (
      <p>
        {title} body{community ? ` for ${community.name}` : ""}
      </p>
    ),
  });
// Built-in sections have their own tests; this file covers plugin card placement.
for (const [path, name] of [
  ["./NotificationSettings", "NotificationSettings"],
  ["./AppearanceSettings", "AppearanceSettings"],
  ["./ShortcutSettings", "ShortcutSettings"],
  ["./ProfileSettings", "ProfileSettings"],
  ["./AgentSettings", "AgentSettings"],
  ["./DeveloperSettings", "DeveloperSettings"],
  ["../features/updates/UpdateSettings", "UpdateSettings"],
] as const)
  vi.doMock(path, () => ({ [name]: () => null }));
const { Settings } = await import("./Settings");
const { SettingsSidebar } = await import("./SettingsSidebar");
const { developerMode } = await import("./settings-sections");
const pluginState = {
  configuration: { status: "loading" },
  activation: {},
  busy: false,
  error: null,
  refreshError: null,
};
const communityState = {
  status: "ready",
  viewer: "ab".repeat(32),
  profile: { name: "Buzz User", picture: "" },
  memberships: [{ id: "primary", name: "Primary" }],
  selected: "primary",
};
const host = {
  plugins: { subscribe: () => () => {}, snapshot: () => pluginState },
  communities: {
    subscribe: () => () => {},
    snapshot: () => communityState,
  },
} as unknown as Parameters<typeof Settings>[0];

it.each([false, true])("groups plugins (Essentials=%s)", (essentials) => {
  const ready = {
    configuration: {
      status: "ready",
      externalPluginsPaused: false,
      catalog: {
        profile: "test",
        location: "test",
        plugins: [
          {
            manifest: {
              id: "buzz.voice-notes",
              name: "Voice Notes",
              apiVersion: 1,
              description: "Record voice notes and play them in conversations.",
              discovery: {
                category: "communication",
                ...(essentials ? { tags: ["  essentials  "] } : {}),
              },
            },
            source: "bundled",
            enabled: true,
            revision: "bundled",
            previous: null,
            reloadable: false,
            error: null,
          },
          {
            manifest: {
              id: "buzz.channels",
              name: "Channels",
              apiVersion: 1,
              description: "Navigate channels and hold conversations in Buzz.",
              discovery: {
                category: "communication",
                ...(essentials ? { tags: ["Essentials"] } : {}),
              },
            },
            source: "bundled",
            enabled: true,
            revision: "bundled",
            previous: null,
            reloadable: false,
            error: null,
          },
          {
            manifest: {
              id: "buzz.codex",
              name: "Codex",
              apiVersion: 1,
              description: "Run local Codex coding agents in Buzz.",
              discovery: {
                category: "agents",
                ...(essentials ? { tags: ["Essentials"] } : {}),
              },
            },
            source: "bundled",
            enabled: true,
            revision: "bundled",
            previous: null,
            reloadable: false,
            error: null,
          },
          {
            manifest: {
              id: "example.invoices",
              name: "Invoices",
              apiVersion: 1,
              description: "Reconcile invoices without leaving Buzz.",
              discovery: { category: "finance" },
            },
            source: "external",
            enabled: false,
            revision: "one",
            previous: null,
            reloadable: true,
            error: null,
          },
        ],
      },
    },
    activation: {},
    busy: false,
    error: null,
    refreshError: null,
  };
  const { cards } = registry([]);
  ready.configuration.catalog.plugins.unshift({
    source: "bundled",
    enabled: true,
    revision: "bundled",
    previous: null,
    reloadable: false,
    error: null,
    manifest: {
      id: "example.messages",
      name: "Messages",
      apiVersion: 1,
      description: "Read messages.",
      discovery: { category: "communication" },
    },
  });
  render(
    <Settings
      {...host}
      cards={cards}
      plugins={
        {
          subscribe: () => () => {},
          snapshot: () => ready,
          change: vi.fn(async () => true),
          reload: vi.fn(async () => true),
          dismissError: vi.fn(),
        } as unknown as Parameters<typeof Settings>[0]["plugins"]
      }
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
  const content = screen.getByRole("region", { name: "Plugins" });
  expect(
    within(content)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(["Communication3 plugins", "Agents1 plugins", "Other1 plugins"]);
  const communication = within(content)
    .getByRole("heading", {
      name: /^Communication/,
    })
    .closest("section");
  expect(communication).not.toBeNull();
  expect(
    within(communication as HTMLElement)
      .getAllByRole("article")
      .map(
        (row) =>
          within(row).getByText(/^(Channels|Voice Notes|Messages)$/)
            .textContent,
      ),
  ).toEqual(
    essentials
      ? ["Channels", "Voice Notes", "Messages"]
      : ["Channels", "Messages", "Voice Notes"],
  );
  expect(within(content).getAllByRole("article")).toHaveLength(5);
  expect(
    within(content).queryAllByRole("img", { name: "Essential" }),
  ).toHaveLength(essentials ? 3 : 0);
  expect(within(content).queryByText("Essential")).toBeNull();
  if (essentials) {
    const name = within(content).getByText("Voice Notes");
    const marker = within(name).getByRole("img", { name: "Essential" });
    expect(marker.previousElementSibling?.tagName.toLowerCase()).toBe("svg");
  }
  expect(
    within(content).queryAllByRole("region", { name: "Essentials" }),
  ).toHaveLength(0);
  expect(
    within(content).queryByRole("switch", { name: "Enable Channels" }),
  ).toBeNull();
  expect(
    within(content).getByRole("switch", {
      name: "Enable Voice Notes",
    }),
  ).toBeEnabled();
  expect(content).toHaveTextContent(
    "Navigate channels and hold conversations in Buzz.",
  );
  expect(content).toHaveTextContent("Run local Codex coding agents in Buzz.");

  const other = within(content)
    .getByRole("heading", { name: /^Other/ })
    .closest("section");
  expect(other).not.toBeNull();
  expect(within(other as HTMLElement).getByText("Invoices")).toBeVisible();
  expect(
    within(other as HTMLElement).getByText(
      "Reconcile invoices without leaving Buzz.",
    ),
  ).toBeVisible();
  expect(
    within(other as HTMLElement).getByRole("switch", {
      name: "Enable Invoices",
    }),
  ).toBeVisible();
  expect(
    within(content).queryByRole("heading", { name: "Finance" }),
  ).toBeNull();
  expect(
    within(content).queryByRole("button", {
      name: "Essentials only",
    }),
  ).toBeNull();
});

it("opens each plugin's existing metadata and controls in a detail aside", () => {
  const { cards } = registry([]);
  const snapshot = {
    configuration: {
      status: "ready" as const,
      externalPluginsPaused: false,
      catalog: {
        profile: "test",
        location: "test",
        plugins: [
          {
            manifest: {
              id: "buzz.channels",
              name: "Channels",
              apiVersion: 1 as const,
              discovery: { tags: ["  Essentials  ", "messaging"] },
            },
            source: "bundled" as const,
            enabled: true,
            revision: "bundled",
            previous: null,
            reloadable: false,
            error: null,
          },
          {
            manifest: {
              id: "example.helper",
              name: "External helper",
              apiVersion: 1 as const,
              discovery: { tags: ["tasks"] },
            },
            source: "external" as const,
            enabled: true,
            revision: "abc123",
            previous: null,
            hasSignature: true,
            publisher: "publisher-public-key",
            reloadable: true,
            error: null,
          },
        ],
      },
    },
    activation: {},
    busy: false,
    error: null,
    refreshError: null,
  };
  const plugins = {
    subscribe: () => () => {},
    snapshot: () => snapshot,
    change: vi.fn(),
    reload: vi.fn(),
    dismissError: vi.fn(),
  } as unknown as Parameters<typeof Settings>[0]["plugins"];

  render(<Settings {...host} cards={cards} plugins={plugins} />);
  fireEvent.click(screen.getByRole("button", { name: "Plugins" }));

  const bundledCard = screen.getByRole("button", {
    name: "View Channels details",
  });
  const artwork = bundledCard.querySelector("img");
  expect(artwork).toHaveAttribute("src", "/channels-icon.png");
  if (!artwork) throw new Error("Expected bundled plugin artwork");
  fireEvent.error(artwork);
  expect(bundledCard.querySelector("img")).toBeNull();
  expect(bundledCard.querySelectorAll("svg")).toHaveLength(3);
  expect(within(bundledCard).queryByText("Buzz")).toBeNull();
  expect(
    within(bundledCard).getByText("Channels").querySelector("svg"),
  ).not.toBeNull();
  expect(screen.queryByRole("switch", { name: "Enable Channels" })).toBeNull();
  expect(screen.queryByText("buzz.channels")).toBeNull();

  fireEvent.click(bundledCard);
  const bundled = screen.getByRole("complementary", {
    name: "Channels details",
  });
  expect(bundled.parentElement).toContainElement(
    screen.getByRole("navigation", { name: "Settings sections" }),
  );
  expect(within(bundled).queryByText("Buzz")).toBeNull();
  expect(within(bundled).getByText("buzz.channels")).toBeVisible();
  expect(within(bundled).queryByText("Signature")).toBeNull();
  const badge = within(bundled).getByText("Made by Buzz");
  expect(badge).toBeVisible();
  expect(badge.parentElement?.parentElement).toContainElement(
    within(bundled).getByRole("heading", { name: "Channels" }),
  );
  expect(badge.nextElementSibling).toHaveTextContent("Essentials");
  expect(within(bundled).getByText("messaging")).toBeVisible();
  expect(within(bundled).queryByText("Installed")).toBeNull();
  const required = within(bundled).getByRole("button", { name: "Required" });
  expect(required).toBeDisabled();
  expect(required).toHaveAttribute("data-variant", "outline");
  expect(required).toHaveAttribute("data-size", "sm");
  fireEvent.click(required);
  expect(plugins.change).not.toHaveBeenCalled();
  const details = within(bundled).getByRole("table", { name: "Details" });
  expect(
    within(details)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent),
  ).toEqual(["Identifier", "Plugin API"]);
  expect(
    within(details).getByRole("cell", { name: "buzz.channels" }),
  ).toBeVisible();

  fireEvent.click(
    within(bundled).getByRole("button", { name: "Close plugin details" }),
  );
  expect(bundledCard).toHaveFocus();
  expect(
    screen.queryByRole("complementary", { name: "Channels details" }),
  ).toBeNull();

  const externalCard = screen.getByRole("button", {
    name: "View External helper details",
  });
  const externalAuthor = within(externalCard).getByText("publisher-public-key");
  expect(externalCard.querySelector("img")).toBeNull();
  expect(externalAuthor.parentElement?.querySelector("svg")).toBeNull();
  const rowToggle = screen.getByRole("switch", {
    name: "Enable External helper",
  });
  expect(rowToggle).toBeChecked();
  expect(externalCard).not.toContainElement(rowToggle);
  fireEvent.click(rowToggle);
  expect(plugins.change).toHaveBeenCalledWith("disable", "example.helper");
  expect(
    screen.queryByRole("complementary", { name: "External helper details" }),
  ).toBeNull();
  fireEvent.click(externalCard);
  const external = screen.getByRole("complementary", {
    name: "External helper details",
  });
  const disable = within(external).getByRole("button", { name: "Disable" });
  expect(within(external).queryByText("Enabled")).toBeNull();
  expect(
    within(external).queryByRole("heading", { name: "Status" }),
  ).toBeNull();
  expect(disable).toHaveAttribute("data-variant", "subtle");
  expect(disable).toHaveAttribute("data-size", "sm");
  expect(within(external).queryByRole("switch")).toBeNull();
  vi.mocked(plugins.change).mockClear();
  fireEvent.click(disable);
  expect(plugins.change).toHaveBeenCalledWith("disable", "example.helper");
  for (const value of ["example.helper", "abc123", "Signed"])
    expect(within(external).getByText(value)).toBeVisible();
  expect(within(external).getAllByText("publisher-public-key")).toHaveLength(2);
  expect(within(external).getByText("Installed")).toBeVisible();
  expect(within(external).queryByText("Made by Buzz")).toBeNull();
  expect(within(external).getByText("tasks")).toBeVisible();
  expect(within(external).queryByText("Essentials")).toBeNull();

  fireEvent.keyDown(external, { key: "Escape" });
  expect(externalCard).toHaveFocus();
  expect(
    screen.queryByRole("complementary", { name: "External helper details" }),
  ).toBeNull();

  const helper = snapshot.configuration.catalog.plugins[1];
  if (!helper) throw new Error("Expected External helper fixture");
  helper.enabled = false;
  fireEvent.click(externalCard);
  const enable = within(
    screen.getByRole("complementary", { name: "External helper details" }),
  ).getByRole("button", { name: "Enable" });
  expect(enable).toHaveAttribute("data-variant", "prominent");
  expect(enable).toHaveAttribute("data-size", "sm");
  fireEvent.click(enable);
  expect(plugins.change).toHaveBeenLastCalledWith("enable", "example.helper");
  fireEvent.keyDown(enable, { key: "Escape" });
  snapshot.busy = true;
  fireEvent.click(externalCard);
  const pending = within(
    screen.getByRole("complementary", { name: "External helper details" }),
  ).getByRole("button", { name: "Enable" });
  expect(pending).toHaveAttribute("aria-disabled", "true");
  vi.mocked(plugins.change).mockClear();
  fireEvent.click(pending);
  expect(plugins.change).not.toHaveBeenCalled();
});

it("uses contributed icons in community and account navigation", () => {
  const { cards } = registry([
    { ...card("groups", "Personal groups"), icon: FolderSimpleIcon },
    { ...card("hosted", "Hosted communities", "Communities"), icon: GlobeIcon },
    card("other", "Other settings"),
  ]);
  render(<Settings {...host} cards={cards} />);
  expect(
    screen
      .getByRole("button", { name: "Personal groups" })
      .querySelector("svg"),
  ).toHaveClass("tabler-icon-folder");
  expect(
    screen
      .getByRole("button", { name: "Hosted communities" })
      .querySelector("svg"),
  ).toHaveClass("tabler-icon-world");
  expect(
    screen.getByRole("button", { name: "Other settings" }).querySelector("svg"),
  ).toHaveClass("tabler-icon-message-circle");
});

it("keeps grouped cards available without a selected community", () => {
  const { cards } = registry([
    card("hosted", "Hosted communities", "Communities"),
    card("groups", "Personal groups"),
  ]);
  const noCommunityState = { ...communityState, selected: null };
  render(
    <Settings
      {...host}
      communities={
        {
          subscribe: () => () => {},
          snapshot: () => noCommunityState,
        } as unknown as Parameters<typeof Settings>[0]["communities"]
      }
      cards={cards}
    />,
  );
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(nav).toHaveTextContent("Communities");
  fireEvent.click(screen.getByRole("button", { name: "Profile" }));
  expect(screen.getByRole("button", { name: "Profile" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    screen.getByRole("button", { name: "Hosted communities" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Personal groups" })).toBeNull();
});

it("shows administration only within a selected community", () => {
  const membership = card(
    "membership",
    "Membership",
    undefined,
    "administration",
  );
  const { cards } = registry([membership]);
  const view = render(<Settings {...host} cards={cards} />);
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(nav).toHaveTextContent("Primary");
  expect(nav).toHaveTextContent("Administration");
  fireEvent.click(screen.getByRole("button", { name: "Membership" }));
  expect(screen.getByText("Membership body for Primary")).toBeVisible();

  const noCommunityState = { ...communityState, selected: null };
  const noCommunity = {
    subscribe: () => () => {},
    snapshot: () => noCommunityState,
  } as unknown as Parameters<typeof Settings>[0]["communities"];
  view.rerender(<Settings {...host} communities={noCommunity} cards={cards} />);
  expect(nav).not.toHaveTextContent("Administration");
  expect(screen.queryByRole("button", { name: "Membership" })).toBeNull();
  expect(screen.queryByText("Membership body")).toBeNull();
});

it("gives contributed cards their own community sections and retires removed cards", async () => {
  const { cards, set } = registry([
    card("hosted", "Hosted communities", "Communities"),
    card("groups", "Personal groups"),
  ]);
  const complete = vi.fn(() => true);
  const onSection = vi.fn();
  render(
    <Settings
      {...host}
      cards={cards}
      navigation={
        {
          target: {
            version: 1,
            kind: "settings",
            section: "example/hosted",
          },
          complete,
        } as never
      }
      onSection={onSection}
    />,
  );
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(nav).toHaveTextContent("Primary");
  expect(nav).toHaveTextContent("Communities");
  expect(await screen.findByText("Hosted communities body")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Hosted communities" }),
  ).toHaveAttribute("aria-current", "page");
  expect(screen.queryByText("Personal groups body")).toBeNull();
  expect(complete).toHaveBeenLastCalledWith({ status: "opened" });

  act(() => set([card("groups", "Personal groups")]));
  await waitFor(() => expect(onSection).toHaveBeenLastCalledWith("profile"));
  expect(screen.queryByText("Hosted communities body")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(nav).not.toHaveTextContent("Hosted communities");
  expect(screen.getByRole("button", { name: "Profile" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});

it("keeps same-id community cards from different plugins distinct", () => {
  const { cards } = registry([
    card("groups", "Example groups"),
    {
      ...card("groups", "Other groups"),
      key: "other/groups",
      pluginId: "other",
    },
  ]);
  render(<Settings {...host} cards={cards} />);
  fireEvent.click(screen.getByRole("button", { name: "Other groups" }));
  expect(screen.getByText("Other groups body for Primary")).toBeVisible();
  expect(screen.queryByText("Example groups body for Primary")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Example groups" }),
  ).not.toHaveAttribute("aria-current");
});

it("keeps Administration hidden after applying a verified ordinary-member roster", async () => {
  const viewer = "a".repeat(64);
  const relayAuthor = "f".repeat(64);
  let resolveRoster!: (events: unknown[]) => void;
  const roster = new Promise<unknown[]>((resolve) => {
    resolveRoster = resolve;
  });
  const membership = createCommunityMembership({
    snapshot: () => ({
      status: "ready",
      generation: 1,
      scope: `https://primary.example:${viewer}`,
      viewer,
      session: {
        relayAuthor,
        read: () => roster,
        profiles: { ensure: vi.fn(async () => {}) },
      },
    }),
    subscribe: () => () => {},
  } as unknown as RelayData);
  const root = new Context();
  root.provide("pluginStatus", {
    isActive: () => true,
    subscribe: () => () => {},
  });
  const cards = new SettingsCardsService(root);
  const scope = root.extend({
    pluginOwner: { id: "moderation", revision: "one" },
  });
  const fiber = scope.plugin((ctx) => {
    ctx.settingsCards.register({
      id: "membership",
      title: "Membership",
      section: "administration",
      visibility: {
        snapshot: () => {
          const state = membership.snapshot();
          return (
            state.status === "ready" &&
            (state.role === "owner" || state.role === "admin")
          );
        },
        subscribe: membership.subscribe,
        ensure: membership.ensure,
      },
      component: () => <p>Membership body</p>,
    });
  });
  await fiber.await();
  render(<Settings {...host} cards={cards} />);
  expect(membership.snapshot().status).toBe("loading");

  resolveRoster([
    {
      id: "1".repeat(64),
      kind: 13534,
      pubkey: relayAuthor,
      created_at: 1,
      content: "",
      sig: "",
      tags: [["member", viewer, "member"]],
    },
  ]);
  await waitFor(() =>
    expect(membership.snapshot()).toMatchObject({
      status: "ready",
      role: "member",
      refreshing: false,
    }),
  );

  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(nav).not.toHaveTextContent("Administration");
  expect(screen.queryByRole("button", { name: "Membership" })).toBeNull();
  await fiber.dispose();
  membership.dispose();
  await root.fiber.dispose();
});

it.each(["primary", null])(
  "presents the same Settings groups in both navigations (%s)",
  (selected) => {
    const { cards } = registry([
      card("groups", "Example groups"),
      card("membership", "Membership", undefined, "administration"),
      card("hosted", "Hosted communities", "Communities"),
    ]);
    const state = { ...communityState, selected };
    const connection = { scope: "settings-parity-test" };
    const communities = {
      subscribe: () => () => {},
      snapshot: () => state,
      relay: {
        subscribe: () => () => {},
        snapshot: () => connection,
      },
    } as unknown as Parameters<typeof Settings>[0]["communities"];
    render(<Settings {...host} communities={communities} cards={cards} />);
    render(
      <SettingsSidebar
        cards={cards}
        communities={communities}
        onBack={() => {}}
        onSection={() => {}}
      />,
    );
    const [standalone, shell] = screen.getAllByRole("navigation", {
      name: "Settings sections",
    });
    const outline = (nav: HTMLElement) =>
      [...nav.querySelectorAll("section")].map((group) => [
        group.querySelector("h2")?.textContent,
        [...group.querySelectorAll("button")].map(
          (button) => button.textContent,
        ),
        [...group.querySelectorAll("button[aria-current]")].map(
          (button) => button.textContent,
        ),
      ]);
    expect(outline(standalone as HTMLElement)).toEqual(
      outline(shell as HTMLElement),
    );
    expect(outline(standalone as HTMLElement).map(([label]) => label)).toEqual([
      ...(selected ? ["Primary", "Administration"] : []),
      "Communities",
      "App",
      ...(developerMode ? ["Development"] : []),
    ]);
    // Existing presentations differ only in the contributed-group icon.
    const hosted = (nav: HTMLElement) =>
      within(nav).getByRole("button", { name: "Hosted communities" });
    expect(hosted(standalone as HTMLElement).querySelector("svg")).toBeNull();
    expect(hosted(shell as HTMLElement).querySelector("svg")).not.toBeNull();
  },
);

it("renders a bundled plugin's README below its status, never an external one's", () => {
  const { cards } = registry([]);
  const plugin = (source: "bundled" | "external") => ({
    manifest: {
      id: source === "bundled" ? "buzz.channels" : "example.helper",
      name: source === "bundled" ? "Channels" : "Helper",
      apiVersion: 1 as const,
      description: "One-line description.",
    },
    source,
    enabled: true,
    revision: source,
    previous: null,
    reloadable: false,
    error: null,
  });
  const snapshot = {
    configuration: {
      status: "ready" as const,
      externalPluginsPaused: false,
      catalog: {
        profile: "test",
        location: "test",
        plugins: [plugin("bundled"), plugin("external")],
      },
    },
    activation: {},
    busy: false,
    error: null,
    refreshError: null,
  };
  const plugins = {
    subscribe: () => () => {},
    snapshot: () => snapshot,
    change: vi.fn(),
    reload: vi.fn(),
    dismissError: vi.fn(),
  } as unknown as Parameters<typeof Settings>[0]["plugins"];

  render(<Settings {...host} cards={cards} plugins={plugins} />);
  fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
  fireEvent.click(
    screen.getByRole("button", { name: "View Channels details" }),
  );
  const bundled = screen.getByRole("complementary", {
    name: "Channels details",
  });
  const about = within(bundled).getByRole("region", {
    name: "Channels README",
  });
  expect(
    within(bundled)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(["Getting started", "Details"]);
  // The title is not repeated; the summary stays beneath the author badge.
  expect(within(bundled).getAllByText("Channels")).toHaveLength(1);
  const summary = within(bundled).getByText("One-line description.");
  expect(summary).toBeVisible();
  expect(summary.parentElement).toContainElement(
    within(bundled).getByText("Made by Buzz"),
  );
  expect(within(about).getByText("Hold conversations.")).toBeVisible();
  expect(
    within(about).getByRole("heading", { name: "Getting started", level: 3 }),
  ).toBeVisible();
  expect(within(about).getByRole("link", { name: "the site" })).toHaveAttribute(
    "href",
    "https://example.com/",
  );
  expect(within(about).queryByRole("link", { name: "the spec" })).toBeNull();
  expect(about).toHaveTextContent("Read the spec or the site.");
  expect(about).toHaveTextContent("Raw markup is dropped.");
  expect(about.querySelector("b")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "View Helper details" }));
  const external = screen.getByRole("complementary", {
    name: "Helper details",
  });
  expect(within(external).queryByRole("heading", { name: "About" })).toBeNull();
  expect(within(external).queryByText("Not from Buzz.")).toBeNull();
  expect(within(external).getByText("One-line description.")).toBeVisible();
});

it("keeps related plugins out of the pane even when tags overlap", () => {
  const { cards } = registry([]);
  const plugin = (
    id: string,
    name: string,
    category: string,
    tags: string[],
    source: "bundled" | "external" = "bundled",
  ) => ({
    manifest: {
      id,
      name,
      apiVersion: 1 as const,
      discovery: { category, tags },
    },
    source,
    enabled: true,
    revision: id,
    previous: null,
    reloadable: false,
    error: null,
  });
  const snapshot = {
    configuration: {
      status: "ready" as const,
      externalPluginsPaused: false,
      catalog: {
        profile: "test",
        location: "test",
        plugins: [
          plugin("buzz.profiles", "Profiles", "people-and-communities", [
            "people",
          ]),
          plugin("buzz.todos", "Todos", "productivity", ["tasks"]),
          plugin("buzz.mentions", "Mentions", "communication", [
            "messaging",
            "people",
          ]),
          plugin("buzz.channels", "Channels", "communication", ["messaging"]),
          plugin(
            "example.helper",
            "Helper",
            "communication",
            ["messaging"],
            "external",
          ),
        ],
      },
    },
    activation: {},
    busy: false,
    error: null,
    refreshError: null,
  };
  const plugins = {
    imports: {
      folder: vi.fn(),
      files: vi.fn(),
      git: vi.fn(),
      discard: vi.fn(),
    },
    subscribe: () => () => {},
    snapshot: () => snapshot,
    change: vi.fn(),
    reload: vi.fn(),
    dismissError: vi.fn(),
  } as unknown as Parameters<typeof Settings>[0]["plugins"];
  const related = (name: string) => {
    const pane = screen.getByRole("complementary", { name: `${name} details` });
    const section = within(pane)
      .queryByRole("heading", { name: "Related plugins" })
      ?.closest("section");
    return section
      ? within(section as HTMLElement)
          .getAllByRole("button")
          .map((button) => button.textContent)
      : [];
  };

  render(<Settings {...host} cards={cards} plugins={plugins} />);
  fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
  const header = screen
    .getByRole("heading", { name: "Plugins" })
    .closest("[data-buzz-ui]");
  expect(header).toContainElement(screen.getByRole("button", { name: "Add" }));
  fireEvent.click(
    screen.getByRole("button", { name: "View Channels details" }),
  );
  expect(related("Channels")).toEqual([]);

  fireEvent.click(
    screen.getByRole("button", { name: "View Mentions details" }),
  );
  expect(related("Mentions")).toEqual([]);
  expect(
    screen.getByRole("button", { name: "View Mentions details" }),
  ).toHaveAttribute("aria-expanded", "true");

  fireEvent.click(screen.getByRole("button", { name: "View Todos details" }));
  expect(related("Todos")).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "View Helper details" }));
  expect(related("Helper")).toEqual([]);
});
