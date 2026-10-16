import type { ImportFile } from "../plugins/types";

const packageFiles = new Set([
  "manifest.json",
  "plugin.js",
  "plugin.artifact.json",
  "plugin.signature.json",
  "README.md",
  "icon.png",
  "icon.jpg",
]);
const skipped = new Set(["node_modules", "target"]);

/** Read only package files from one explicitly dropped directory; never execute it. */
export async function readPluginFolder(root: FileSystemEntry) {
  if (!root.isDirectory)
    throw new Error("Drop a folder, or choose Add from folder.");
  const files: ImportFile[] = [];
  let entries = 0;
  let bytes = 0;
  const deadline = Date.now() + 60_000;
  async function visit(
    entry: FileSystemEntry,
    path: string,
    depth: number,
  ): Promise<void> {
    if (
      ++entries > 20_000 ||
      (entry.isDirectory && depth > 32) ||
      Date.now() > deadline
    )
      throw new Error(
        "Folder is too large or deeply nested. Choose a smaller folder.",
      );
    if (entry.isDirectory) {
      if (depth && (entry.name.startsWith(".") || skipped.has(entry.name)))
        return;
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns batches; one call does not enumerate a whole directory.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch)
          await visit(
            child,
            path ? `${path}/${child.name}` : child.name,
            depth + 1,
          );
      }
    } else if (entry.isFile && packageFiles.has(entry.name)) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      bytes += file.size;
      const icon = entry.name === "icon.png" || entry.name === "icon.jpg";
      const limit = icon
        ? 1024 * 1024
        : entry.name === "README.md"
          ? 256 * 1024
          : 8 * 1024 * 1024;
      if (file.size > limit || bytes > 32 * 1024 * 1024)
        throw new Error(
          "Dropped plugin files exceed the README (256 KiB), icon (1 MiB), code (8 MiB), or total (32 MiB) limit.",
        );
      const contents = new Uint8Array(await file.arrayBuffer());
      if (icon) {
        // Preserve arbitrary image bytes without interpreting them as UTF-8.
        let binary = "";
        for (let offset = 0; offset < contents.length; offset += 8192)
          binary += String.fromCharCode(
            ...contents.subarray(offset, offset + 8192),
          );
        files.push({ path, base64: btoa(binary) });
        return;
      }
      // Match the native reader: reject invalid UTF-8 and preserve a BOM.
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(contents);
      files.push({ path, text });
    }
  }
  await visit(root, "", 0);
  return { source: root.name, files };
}
