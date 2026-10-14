// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Channel, type invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackupIdentity } from "./BackupIdentity";
import { createIdentityBackup, type BackupStatus } from "./backup";

type Result = { Ok: boolean } | { Err: string };
type WireMessage =
  | { message: Result; index: number }
  | { end: true; index: number };
const callbacks = new Map<number, (message: WireMessage) => void>();
const originalInternals = Object.getOwnPropertyDescriptor(
  window,
  "__TAURI_INTERNALS__",
);
let sequence = 0;
beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      transformCallback(callback: (message: WireMessage) => void) {
        const id = ++sequence;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
    },
  });
});
afterEach(() => {
  cleanup();
  callbacks.clear();
  if (originalInternals)
    Object.defineProperty(window, "__TAURI_INTERNALS__", originalInternals);
  else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

// The service and Tauri Channel are real; only native responses are controlled.
function setup(initial: BackupStatus) {
  let status = initial;
  const send = vi.fn(
    async (command: string, _args?: Record<string, unknown>) => {
      if (command === "nsec_upload_status") return status;
      if (command === "nsec_upload" || command === "nsec_upload_cancel") return;
      throw new Error(`Unexpected command ${command}`);
    },
  );
  const backup = createIdentityBackup(
    "builderlab",
    () => "synthetic-token",
    send as typeof invoke,
  );
  const complete = (result: Result) => {
    const channel = send.mock.calls
      .filter(([command]) => command === "nsec_upload")
      .at(-1)?.[1]?.onResult;
    expect(channel).toBeInstanceOf(Channel);
    const deliver = callbacks.get((channel as Channel<Result>).id);
    if (!deliver) throw new Error("No native backup callback");
    deliver({ message: result, index: 0 });
    deliver({ end: true, index: 1 });
  };
  return {
    backup,
    send,
    complete,
    setStatus: (next: BackupStatus) => {
      status = next;
    },
  };
}

it.each([false, null])(
  "reports automatic=%s without offering or starting an upload",
  async (automatic) => {
    const { backup, send } = setup({
      available: true,
      automatic,
      stored: false,
    });
    render(<BackupIdentity backup={backup} active={() => true} />);
    expect(
      await screen.findByText(
        automatic === false
          ? /You manage your own cryptography/
          : /No backup choice has been verified/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(send.mock.calls.map(([command]) => command)).toEqual([
      "nsec_upload_status",
    ]);
  },
);

it("hides the status widget when the native backup service is unavailable", async () => {
  const { backup, send } = setup({
    available: false,
    automatic: null,
    stored: false,
  });
  await act(async () => {
    render(<BackupIdentity backup={backup} active={() => true} />);
  });
  expect(send).toHaveBeenCalledWith("nsec_upload_status", {});
  expect(
    screen.queryByRole("region", { name: "Identity backup" }),
  ).not.toBeInTheDocument();
});

it("retries an opted-in backup and reports storage only after native completion and receipt status", async () => {
  const fixture = setup({ available: true, automatic: true, stored: false });
  render(<BackupIdentity backup={fixture.backup} active={() => true} />);
  const retry = await screen.findByRole("button", { name: "Retry backup" });
  expect(screen.getByText(/Block can recover this key/)).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    "A stored backup has not been confirmed.",
  );
  expect(
    fixture.send.mock.calls.filter(([command]) => command === "nsec_upload"),
  ).toEqual([]);
  await userEvent.setup().click(retry);
  expect(fixture.send).toHaveBeenCalledWith("nsec_upload", {
    source: "builderlab",
    credential: "synthetic-token",
    onResult: expect.any(Channel),
  });
  expect(retry).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Backing up your identity…",
  );
  fixture.setStatus({ available: true, automatic: true, stored: true });
  await act(async () => fixture.complete({ Ok: true }));
  expect(
    await screen.findByText("Encrypted identity backup stored."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Retry backup" }),
  ).not.toBeInTheDocument();
  expect(callbacks.size).toBe(0);
});

it("keeps a failed backup unconfirmed and offers a retry without changing the saved choice", async () => {
  const fixture = setup({ available: true, automatic: true, stored: false });
  render(<BackupIdentity backup={fixture.backup} active={() => true} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Retry backup" }));
  await act(async () => fixture.complete({ Err: "Sign in again." }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again.");
  expect(screen.getByRole("status")).toHaveTextContent(
    "A stored backup has not been confirmed.",
  );
  const retry = screen.getByRole("button", { name: "Retry backup" });
  expect(retry).not.toHaveAttribute("aria-disabled", "true");
  await user.click(retry);
  fixture.setStatus({ available: true, automatic: true, stored: true });
  await act(async () => fixture.complete({ Ok: true }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Encrypted identity backup stored.",
  );
  expect(
    fixture.send.mock.calls.filter(
      ([command]) => command === "nsec_upload_choice",
    ),
  ).toEqual([]);
});
