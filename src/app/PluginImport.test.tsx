// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginManager } from "../plugins/manager";
import type { Catalog, ImportPreview } from "../plugins/types";
import { PluginImport } from "./PluginImport";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);

it("opens both sources and the safety hint only inside Add, and restores focus on close", async () => {
  const user = userEvent.setup();
  const manager = {
    imports: { folder: vi.fn(), discard: vi.fn() },
  } as unknown as PluginManager;
  render(
    <PluginImport
      plugins={manager}
      catalog={{ profile: "test", location: "test", plugins: [] }}
      busy={false}
    />,
  );
  const add = screen.getByRole("button", { name: "Add" });
  expect(add).toHaveAttribute("data-size", "sm");
  expect(screen.queryByLabelText("Git or GitHub repository")).toBeNull();
  expect(screen.queryByText(/plugins aren’t sandboxed/)).toBeNull();
  fireEvent.click(add);
  const dialog = screen.getByRole("dialog", { name: "Add a plugin" });
  expect(
    within(dialog).getByLabelText("Git or GitHub repository"),
  ).toBeVisible();
  expect(within(dialog).getByText(/plugins aren’t sandboxed/)).toBeVisible();
  expect(
    within(dialog).getByRole("button", { name: "Browse plugin folder" }),
  ).toBeVisible();
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(add).toHaveFocus());
  await user.click(add);
  await user.click(document.querySelector(".buzz-dialog-backdrop") as Element);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("blocks dismissal and duplicate acquisition while loading, then discards the preview on close", async () => {
  const user = userEvent.setup();
  let resolve!: (value: ImportPreview) => void;
  const gate = new Promise<ImportPreview>((done) => {
    resolve = done;
  });
  const folder = vi.fn(() => gate);
  const discard = vi.fn(async () => {});
  const manager = { imports: { folder, discard } } as unknown as PluginManager;
  render(
    <PluginImport
      plugins={manager}
      catalog={{ profile: "test", location: "test", plugins: [] }}
      busy={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  const dialog = screen.getByRole("dialog");
  const browse = within(dialog).getByRole("button", {
    name: "Browse plugin folder",
  });
  fireEvent.click(browse);
  try {
    expect(folder).toHaveBeenCalledTimes(1);
    expect(browse).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Close" }),
    ).toBeDisabled();
    fireEvent.click(browse);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await user.click(
      document.querySelector(".buzz-dialog-backdrop") as Element,
    );
    expect(dialog).toBeVisible();
    expect(folder).toHaveBeenCalledTimes(1);
  } finally {
    resolve({
      token: "drop-preview",
      source: "test",
      candidates: [],
      warnings: [],
      commit: null,
    });
  }
  await screen.findByRole("region", { name: "Plugin import preview" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(discard).toHaveBeenCalledWith("drop-preview"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("routes folder-drop contents through preview without installing, and rejects a loose file", async () => {
  const files = vi.fn(async () => ({
    token: "uploaded",
    source: "Dropped folder: example",
    candidates: [],
    warnings: [],
    commit: null,
  }));
  const manager = {
    imports: { files, discard: vi.fn(async () => {}) },
    installImport: vi.fn(),
  } as unknown as PluginManager;
  render(
    <PluginImport
      plugins={manager}
      catalog={{ profile: "test", location: "test", plugins: [] }}
      busy={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  const zone = screen.getByRole("region", { name: "Add from folder" });
  const entry = {
    name: "example",
    isDirectory: true,
    createReader: () => ({
      readEntries: (done: (entries: unknown[]) => void) => done([]),
    }),
  };
  fireEvent.drop(zone, {
    dataTransfer: { items: [{ webkitGetAsEntry: () => entry }] },
  });
  await waitFor(() => expect(files).toHaveBeenCalledWith("example", []));
  await screen.findByRole("region", { name: "Plugin import preview" });
  expect(manager.installImport).not.toHaveBeenCalled();
  fireEvent.drop(zone, {
    dataTransfer: {
      items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
    },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Drop one folder");
  expect(files).toHaveBeenCalledTimes(1);
});

it("shows exact declared access and changes before an enabled update", async () => {
  const preview: ImportPreview = {
    token: "preview",
    source: "/example",
    commit: null,
    warnings: [],
    candidates: [
      {
        path: "dist",
        revision: "two",
        readmeRevision: "readme-two",
        iconPngRevision: null,
        iconJpgRevision: "jpg-two",
        manifest: {
          id: "example.plugin",
          name: "Example",
          apiVersion: 1,
          host: {
            commands: [
              {
                id: "check",
                program: "example-cli",
                args: ["status", "--json"],
              },
            ],
            networkOrigins: ["https://api.example.com"],
            processes: [{ id: "worker", program: "example-worker" }],
            mcp: true,
          },
        },
      },
    ],
  };
  const catalog: Catalog = {
    profile: "test",
    location: "test",
    plugins: [
      {
        manifest: {
          id: "example.plugin",
          name: "Example",
          apiVersion: 1,
          host: {
            commands: [
              {
                id: "check",
                program: "example-cli",
                args: ["status", "--brief"],
              },
            ],
            networkOrigins: ["https://old.example.com"],
          },
        },
        source: "external",
        enabled: true,
        revision: "one",
        previous: null,
        reloadable: false,
        error: null,
        readmeRevision: "readme-one",
        iconPngRevision: "icon-one",
      },
    ],
  };
  const manager = {
    imports: {
      folder: vi.fn(async () => preview),
      git: vi.fn(),
      install: vi.fn(),
      discard: vi.fn(async () => {}),
    },
    installImport: vi.fn(async () => true),
  } as unknown as PluginManager;
  render(<PluginImport plugins={manager} catalog={catalog} busy={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  fireEvent.click(screen.getByRole("button", { name: "Browse plugin folder" }));
  await screen.findByRole("region", { name: "Computer access" });
  expect(screen.getByText("Run example-cli on your computer.")).toBeVisible();
  expect(
    screen.getByText(/Start example-worker with additional arguments/),
  ).toBeVisible();
  expect(screen.getByText("Provide tools to local agents.")).toBeVisible();
  expect(
    screen.getByText(/This list doesn’t describe everything/),
  ).toBeVisible();
  expect(
    screen.getByText(/Computer access changes with this update/),
  ).toBeVisible();
  expect(screen.queryByText(/Command check:/)).toBeNull();
  expect(screen.getByRole("button", { name: "Update plugin" })).toHaveAttribute(
    "data-variant",
    "prominent",
  );
  fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
  const command = screen
    .getByText(/^Command check:/, { selector: "li code" })
    .closest("li");
  expect(command).toBeVisible();
  expect(command).toHaveTextContent(
    /example-cli.*status.*--json.*new or changed/,
  );
  expect(screen.getByText(/^HTTPS origin:/).closest("li")).toHaveTextContent(
    /https:\/\/api.example.com.*new or changed/,
  );
  expect(screen.getByText(/^Removed:/)).toHaveTextContent(
    /--brief.*https:\/\/old.example.com/,
  );
  expect(screen.getByText("README.md included (changed)")).toBeVisible();
  expect(screen.getByText("icon.png removed")).toBeVisible();
  expect(screen.getByText("icon.jpg included (new)")).toBeVisible();
  expect(screen.getByText(/not an endorsement by Buzz/)).toBeVisible();
  expect(
    screen.getByText(
      /stays on and may run immediately unless this launch is in safe mode/,
    ),
  ).toBeVisible();
  expect(manager.installImport).not.toHaveBeenCalled();
});

const outputLimitUpdates = [
  { previous: undefined, next: 65536, changed: true },
  { previous: 4096, next: 1048576, changed: true },
  { previous: 65536, next: 4096, changed: true },
  { previous: 65536, next: undefined, changed: true },
  { previous: undefined, next: 4096, changed: false },
  { previous: 4096, next: undefined, changed: false },
  { previous: 65536, next: 65536, changed: false },
];
const inputLimitUpdates = [
  { previous: undefined, next: 1, changed: true },
  { previous: 1, next: 65536, changed: true },
  { previous: 65536, next: 1, changed: true },
  { previous: 65536, next: undefined, changed: true },
  { previous: undefined, next: undefined, changed: false },
  { previous: 65536, next: 65536, changed: false },
];

it.each([
  ...outputLimitUpdates.map((update) => ({
    ...update,
    kind: "output" as const,
  })),
  ...inputLimitUpdates.map((update) => ({ ...update, kind: "input" as const })),
])(
  "reviews $kind-limit-only updates from $previous to $next",
  async ({ previous, next, changed, kind }) => {
    const limit = kind === "input" ? "maxInputBytes" : "maxOutputBytes";
    const allowance = (value: number | undefined) =>
      kind === "input" && value === undefined
        ? "input: none"
        : `${kind}: up to ${value ?? 4096} bytes`;
    const command = {
      id: "tools",
      program: "agent-tools",
      args: ["list", "--json"],
    };
    const manifest = {
      id: "example.plugin",
      name: "Example",
      apiVersion: 1,
    } as const;
    const preview: ImportPreview = {
      token: "preview",
      source: "/example",
      commit: null,
      warnings: [],
      candidates: [
        {
          path: "dist",
          revision: "two",
          manifest: {
            ...manifest,
            host: {
              commands: [
                {
                  ...command,
                  ...(next === undefined ? {} : { [limit]: next }),
                },
              ],
            },
          },
        },
      ],
    };
    const catalog: Catalog = {
      profile: "test",
      location: "test",
      plugins: [
        {
          manifest: {
            ...manifest,
            host: {
              commands: [
                {
                  ...command,
                  ...(previous === undefined ? {} : { [limit]: previous }),
                },
              ],
            },
          },
          source: "external",
          enabled: true,
          revision: "one",
          previous: null,
          reloadable: false,
          error: null,
        },
      ],
    };
    const manager = {
      imports: {
        folder: vi.fn(async () => preview),
        discard: vi.fn(async () => {}),
      },
      installImport: vi.fn(),
    } as unknown as PluginManager;
    render(<PluginImport plugins={manager} catalog={catalog} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Browse plugin folder" }),
    );
    const access = within(
      await screen.findByRole("region", { name: "Computer access" }),
    );
    fireEvent.click(access.getByRole("button", { name: "Technical details" }));
    const grant = access
      .getByText(/^Command /, { selector: "li code" })
      .closest("li");
    expect(
      screen.queryByRole("region", { name: "Package content" }),
    ).not.toBeInTheDocument();
    expect(grant).toHaveTextContent(allowance(next));
    if (changed) {
      expect(grant).toHaveTextContent("(new or changed)");
      expect(access.getByText(/^Removed:/)).toHaveTextContent(
        allowance(previous),
      );
    } else {
      expect(grant).not.toHaveTextContent("(new or changed)");
      expect(access.queryByText(/^Removed:/)).not.toBeInTheDocument();
    }
    expect(manager.installImport).not.toHaveBeenCalled();
  },
);

it("signs in only to repositories the community authorizes", async () => {
  const user = userEvent.setup();
  const preview: ImportPreview = {
    token: "preview",
    source: "repo",
    commit: null,
    warnings: [],
    candidates: [],
  };
  const git = vi.fn(async () => preview);
  const manager = {
    imports: {
      folder: vi.fn(),
      git,
      install: vi.fn(),
      discard: vi.fn(async () => {}),
    },
    installImport: vi.fn(),
  } as unknown as PluginManager;
  const buzz = `https://relay.test/git/${"a".repeat(64)}/plugins`;
  const authorizeGit = vi.fn(async (repository: string) =>
    repository.includes("/git/")
      ? { repository: buzz, token: "dG9rZW4=" }
      : null,
  );
  render(
    <PluginImport
      plugins={manager}
      catalog={{ profile: "test", location: "test", plugins: [] }}
      busy={false}
      authorizeGit={authorizeGit}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Add" }));
  const field = screen.getByLabelText("Git or GitHub repository");
  const find = screen.getByRole("button", { name: "Find plugins" });
  fireEvent.change(field, { target: { value: ` ${buzz} ` } });
  find.focus();
  await user.click(find);
  await screen.findByRole("region", { name: "Plugin import preview" });
  expect(screen.queryByRole("form", { name: "Add from Git" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Browse plugin folder" }),
  ).toBeNull();
  const back = screen.getByRole("button", { name: "Back" });
  await waitFor(() => expect(back).toHaveFocus());
  await user.click(back);
  await waitFor(() => expect(find).toHaveFocus());
  expect(field).toHaveValue(` ${buzz} `);
  expect(manager.imports?.discard).toHaveBeenCalledWith("preview");
  await waitFor(() => expect(git).toHaveBeenCalledTimes(1));
  expect(git).toHaveBeenLastCalledWith(buzz, "", "dG9rZW4=");
  fireEvent.change(field, { target: { value: "block/plugins" } });
  await waitFor(() => expect(find).toBeEnabled());
  await user.click(find);
  await waitFor(() => expect(git).toHaveBeenCalledTimes(2));
  expect(git).toHaveBeenLastCalledWith("block/plugins", "");
});

it("replaces Add with an error view and returns to the retained preview for retry", async () => {
  const preview: ImportPreview = {
    token: "retry-preview",
    source: "test",
    commit: null,
    warnings: [],
    candidates: [
      {
        path: ".",
        manifest: { id: "example.retry", name: "Retry plugin", apiVersion: 1 },
        revision: "one",
        publisher: null,
      },
    ],
  };
  let error: string | null = "Publisher mismatch";
  let finish!: (success: boolean) => void;
  const installImport = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true)
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
  const manager = {
    imports: {
      folder: vi.fn(async () => preview),
      discard: vi.fn(async () => {}),
    },
    snapshot: () => ({ error }),
    installImport,
  } as unknown as PluginManager;
  render(
    <PluginImport
      plugins={manager}
      catalog={{ profile: "test", location: "test", plugins: [] }}
      busy={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  fireEvent.click(screen.getByRole("button", { name: "Browse plugin folder" }));
  const dialog = screen.getByRole("dialog", { name: "Add a plugin" });
  const install = await within(dialog).findByRole("button", {
    name: "Install plugin",
  });
  expect(within(dialog).queryByRole("radio")).toBeNull();
  expect(within(dialog).queryByText("Choose a plugin folder")).toBeNull();
  expect(within(dialog).getByText("Retry plugin")).toBeVisible();
  expect(within(dialog).getByText("example.retry")).toBeVisible();
  expect(install).toHaveAttribute("data-variant", "prominent");
  install.focus();
  fireEvent.click(install);
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Publisher mismatch",
  );
  expect(
    within(dialog).queryByRole("region", { name: "Plugin import preview" }),
  ).toBeNull();
  expect(
    within(dialog).queryByRole("button", { name: "Browse plugin folder" }),
  ).toBeNull();
  const back = within(dialog).getByRole("button", { name: "Back" });
  expect(back).toHaveFocus();
  fireEvent.click(back);
  const retry = within(dialog).getByRole("button", { name: "Install plugin" });
  expect(retry).toHaveFocus();
  expect(
    within(dialog).getByRole("region", { name: "Plugin import preview" }),
  ).toBeVisible();
  error = null;
  fireEvent.click(retry);
  expect(await within(dialog).findByRole("status")).toHaveTextContent(
    "Retry plugin installed",
  );
  expect(within(dialog).queryByRole("alert")).toBeNull();
  fireEvent.click(retry);
  expect(within(dialog).queryByRole("status")).toBeNull();
  error = "Persistence failed";
  finish(false);
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Persistence failed",
  );
  expect(installImport.mock.calls).toEqual(
    Array(3).fill(["retry-preview", "."]),
  );
});

it("shows a rejected dropped candidate's warning beside a usable sibling preview", async () => {
  const entryFile = (name: string, size: number) => ({
    name,
    isFile: true,
    isDirectory: false,
    file: (resolve: (file: unknown) => void) =>
      resolve({
        size,
        arrayBuffer: async () => new TextEncoder().encode("{}").buffer,
      }),
  });
  const directory = (name: string, children: unknown[]) => ({
    name,
    isDirectory: true,
    isFile: false,
    createReader: () => {
      let read = false;
      return {
        readEntries: (resolve: (entries: unknown[]) => void) => {
          resolve(read ? [] : children);
          read = true;
        },
      };
    },
  });
  const files = vi.fn(async () => ({
    token: "partial",
    source: "Dropped folder",
    commit: null,
    candidates: [
      {
        path: "good",
        revision: "one",
        manifest: { id: "example.good", name: "Good plugin", apiVersion: 1 },
      },
    ],
    warnings: [],
  }));
  const manager = {
    imports: { files, discard: vi.fn(async () => {}) },
  } as unknown as PluginManager;
  render(
    <PluginImport
      plugins={manager}
      catalog={{ profile: "test", location: "test", plugins: [] }}
      busy={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  const root = directory("plugins", [
    directory("bad", [
      entryFile("manifest.json", 2),
      entryFile("README.md", 300 * 1024),
    ]),
    directory("good", [
      entryFile("manifest.json", 2),
      entryFile("plugin.js", 2),
    ]),
  ]);
  fireEvent.drop(screen.getByRole("region", { name: "Add from folder" }), {
    dataTransfer: { items: [{ webkitGetAsEntry: () => root }] },
  });
  const warning = await screen.findByText(/bad:.*limit/);
  expect(warning).toBeVisible();
  expect(screen.getByRole("button", { name: "Install plugin" })).toBeEnabled();
  expect(files).toHaveBeenCalledWith("plugins", [
    { path: "good/manifest.json", text: "{}" },
    { path: "good/plugin.js", text: "{}" },
  ]);
});

it("Back restores source fields and focus after acquisition fails", async () => {
  const user = userEvent.setup();
  const git = vi.fn(async () => {
    throw new Error("Repository unavailable");
  });
  const manager = { imports: { git } } as unknown as PluginManager;
  render(
    <PluginImport
      plugins={manager}
      catalog={{ profile: "test", location: "test", plugins: [] }}
      busy={false}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.type(
    screen.getByLabelText("Git or GitHub repository"),
    "https://github.com/example/plugin",
  );
  await user.type(screen.getByLabelText("Branch or tag (optional)"), "stable");
  const find = screen.getByRole("button", { name: "Find plugins" });
  await user.click(find);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Repository unavailable",
  );
  expect(screen.queryByRole("form", { name: "Add from Git" })).toBeNull();
  const back = screen.getByRole("button", { name: "Back" });
  expect(back).toHaveFocus();
  await user.click(back);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText("Git or GitHub repository")).toHaveValue(
    "https://github.com/example/plugin",
  );
  expect(screen.getByLabelText("Branch or tag (optional)")).toHaveValue(
    "stable",
  );
  expect(find).toHaveFocus();
});
