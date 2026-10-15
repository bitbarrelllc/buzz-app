const packageFiles = new Set([
  "manifest.json",
  "plugin.js",
  "plugin.artifact.json",
  "plugin.signature.json",
]);
const skipped = new Set(["node_modules", "target"]);

/** Read only package text from one explicitly dropped directory; never execute it. */
export async function readPluginFolder(root: FileSystemEntry) {
  if (!root.isDirectory)
    throw new Error("Drop a folder, or choose Add from folder.");
  const files: { path: string; text: string }[] = [];
  let entries = 0;
  let bytes = 0;
  const deadline = Date.now() + 60_000;
  async function visit(
    entry: FileSystemEntry,
    path: string,
    depth: number,
  ): Promise<void> {
    if (++entries > 20_000 || depth > 32 || Date.now() > deadline)
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
      if (file.size > 8 * 1024 * 1024 || bytes > 32 * 1024 * 1024)
        throw new Error(
          "Dropped plugin files exceed the 8 MiB file / 32 MiB total limit.",
        );
      // Match the native reader: reject invalid UTF-8 and preserve a BOM.
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(await file.arrayBuffer());
      files.push({ path, text });
    }
  }
  await visit(root, "", 0);
  return { source: root.name, files };
}
