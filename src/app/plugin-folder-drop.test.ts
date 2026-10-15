import { expect, it, vi } from "vitest";
import { readPluginFolder } from "./plugin-folder-drop";

function file(name: string, text = "{}", size = text.length) {
  const read = vi.fn(async () => new TextEncoder().encode(text).buffer);
  return {
    name,
    isDirectory: false,
    isFile: true,
    file: (resolve: (value: unknown) => void) =>
      resolve({ size, arrayBuffer: read }),
    read,
  } as unknown as FileSystemFileEntry & { read: typeof read };
}

function folder(
  name: string,
  batches: FileSystemEntry[][],
): FileSystemDirectoryEntry {
  return {
    name,
    isDirectory: true,
    isFile: false,
    createReader: () => {
      let index = 0;
      return {
        readEntries: (resolve: (entries: FileSystemEntry[]) => void) =>
          resolve(batches[index++] ?? []),
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

it("reads every batch, preserving nested paths and skipping tool folders and unrelated files", async () => {
  const ignored = file("secret.txt");
  const hidden = file("plugin.js");
  const root = folder("plugins", [
    [folder("dist", [[file("manifest.json"), file("plugin.js", "export {}")]])],
    [ignored, folder("node_modules", [[hidden]]), folder(".git", [[hidden]])],
  ]);
  expect(await readPluginFolder(root)).toEqual({
    source: "plugins",
    files: [
      { path: "dist/manifest.json", text: "{}" },
      { path: "dist/plugin.js", text: "export {}" },
    ],
  });
  expect(ignored.read).not.toHaveBeenCalled();
  expect(hidden.read).not.toHaveBeenCalled();
});

it("accepts signed release files without altering their text", async () => {
  expect(
    (
      await readPluginFolder(
        folder("release", [
          [
            file("plugin.artifact.json", "artifact"),
            file("plugin.signature.json", "signature"),
          ],
        ]),
      )
    ).files,
  ).toEqual([
    { path: "plugin.artifact.json", text: "artifact" },
    { path: "plugin.signature.json", text: "signature" },
  ]);
});

it("rejects a file or oversized package before reading its contents", async () => {
  await expect(readPluginFolder(file("plugin.js"))).rejects.toThrow(
    "Drop a folder",
  );
  const large = file("plugin.js", "", 8 * 1024 * 1024 + 1);
  await expect(readPluginFolder(folder("large", [[large]]))).rejects.toThrow(
    "limit",
  );
  expect(large.read).not.toHaveBeenCalled();
});

it("bounds recursive traversal", async () => {
  let root = folder("last", []);
  for (let i = 0; i < 34; i++) root = folder(`level-${i}`, [[root]]);
  await expect(readPluginFolder(root)).rejects.toThrow("deeply nested");
});

it("preserves a BOM and rejects invalid UTF-8 instead of replacing bytes", async () => {
  expect(
    (
      await readPluginFolder(
        folder("bom", [[file("plugin.js", "\uFEFFexport {}")]]),
      )
    ).files[0]?.text,
  ).toBe("\uFEFFexport {}");
  const invalid = file("plugin.js");
  invalid.read.mockResolvedValueOnce(new Uint8Array([0xff]).buffer);
  await expect(
    readPluginFolder(folder("invalid", [[invalid]])),
  ).rejects.toThrow();
});
