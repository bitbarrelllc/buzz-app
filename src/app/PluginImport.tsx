import { Header } from "../shared/design-system/ui/Header";
import { SettingsGroup } from "../shared/design-system/ui/SettingsGroup";
import { Field } from "../shared/design-system/ui/Field";
import { Input } from "../shared/design-system/ui/Input";
import { Radio, RadioGroup } from "../shared/design-system/ui/RadioGroup";
import { Button } from "../shared/design-system/ui/Button";
import { Accordion } from "../shared/design-system/ui/Accordion";
import { Dialog } from "../shared/design-system/ui/Dialog";
import { readPluginFolder } from "./plugin-folder-drop";
import styles from "./PluginImport.module.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FolderOpenIcon,
  SquaresFourIcon,
} from "../shared/design-system/icons/index";
import type { PluginManager } from "../plugins/manager";
import type { Catalog, ImportPreview } from "../plugins/types";
import type { PluginManifest } from "../plugins/api";

function importLocation(preview: ImportPreview, path: string | undefined) {
  if (!path || path === ".") return preview.source;
  if (preview.commit) return `${preview.source} · ${path}`;
  const windows = /^(?:[a-z]:\\|\\\\)/i.test(preview.source);
  const separator = windows ? "\\" : "/";
  const source = preview.source.replace(windows ? /\\+$/ : /\/+$/, "");
  return `${source}${separator}${path.replaceAll("/", separator)}`;
}

function hostGrants(manifest: PluginManifest): string[] {
  return [
    ...(manifest.host?.commands ?? []).map(
      (command) =>
        `Command ${command.id}: ${JSON.stringify([command.program, ...command.args])} · input: ${command.maxInputBytes === undefined ? "none" : `up to ${command.maxInputBytes} bytes`} · output: up to ${command.maxOutputBytes ?? 4096} bytes`,
    ),
    ...(manifest.host?.networkOrigins ?? []).map(
      (origin) => `HTTPS origin: ${origin}`,
    ),
    ...(manifest.host?.processes ?? []).map(
      (process) =>
        `Process ${process.id}: ${JSON.stringify([process.program, ...(process.args ?? [])])}${process.bundled ? " (bundled with Buzz)" : ""} and any further arguments · stdin, full user access`,
    ),
    ...(manifest.host?.mcp
      ? ["MCP servers: tools served to local agents over loopback HTTP"]
      : []),
  ];
}

function contentChange(
  name: string,
  next: string | null | undefined,
  previous: string | null | undefined,
  updating: boolean,
) {
  if (!updating) return next ? `${name} included` : null;
  if (!next) return previous ? `${name} removed` : null;
  if (!previous) return `${name} included (new)`;
  return `${name} included (${next === previous ? "unchanged" : "changed"})`;
}

export function PluginImport({
  plugins,
  catalog,
  busy,
  authorizeGit,
  actionTarget,
}: {
  plugins: PluginManager;
  catalog: Catalog;
  busy: boolean;
  actionTarget?: HTMLElement | null;
  /** Signs in to the selected community's Buzz git; null for other repositories. */
  authorizeGit?: (
    repository: string,
  ) => Promise<{ repository: string; token: string } | null>;
}) {
  const imports = plugins.imports;
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [repository, setRepository] = useState("");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const previewRegion = useRef<HTMLElement>(null);
  const [error, setError] = useState<string | null>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const errorBack = useRef<HTMLButtonElement>(null);
  const previewBack = useRef<HTMLButtonElement>(null);
  const sourceTrigger = useRef<HTMLElement | null>(null);
  const installButton = useRef<HTMLButtonElement>(null);
  const errorReturnsToBack = useRef(false);
  useLayoutEffect(() => {
    if (!open || loading || discarding) return;
    if (preview) {
      const checked = !reviewing
        ? previewRegion.current?.querySelector<HTMLElement>(
            '[role="radio"][aria-checked="true"], input[type="radio"]:checked',
          )
        : null;
      (checked ?? previewBack.current)?.focus();
    } else if (sourceTrigger.current) {
      if (sourceTrigger.current === document.body) browse.current?.focus();
      else sourceTrigger.current.focus();
      sourceTrigger.current = null;
    }
  }, [open, preview, loading, discarding, reviewing]);
  const errorTrigger = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (busy || loading || discarding) return;
    if (error) errorBack.current?.focus();
    else if (errorTrigger.current) {
      if (errorTrigger.current === document.body) browse.current?.focus();
      else if (errorTrigger.current.isConnected) errorTrigger.current.focus();
      else if (errorReturnsToBack.current) previewBack.current?.focus();
      else (installButton.current ?? previewBack.current)?.focus();
      errorTrigger.current = null;
    }
  }, [error, busy, loading, discarding]);
  function showError(reason: unknown) {
    if (!error) {
      errorTrigger.current = document.activeElement as HTMLElement | null;
      errorReturnsToBack.current =
        document.activeElement === previewBack.current;
    }
    setError(String(reason));
  }
  const [notice, setNotice] = useState<string | null>(null);
  const lifetime = useRef({ active: true, token: "" });
  const pending = useRef(false);
  useEffect(() => {
    const current = { active: true, token: "" };
    lifetime.current = current;
    return () => {
      current.active = false;
      if (current.token) void imports?.discard(current.token).catch(() => {});
    };
  }, [imports]);

  const blocked = busy || loading || discarding;
  if (!imports) return null;

  async function load(operation: () => Promise<ImportPreview | null>) {
    if (pending.current || blocked) return;
    sourceTrigger.current = document.activeElement as HTMLElement | null;
    pending.current = true;
    const current = lifetime.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    try {
      const next = await operation();
      if (!current.active) {
        if (next) await imports?.discard(next.token);
        return;
      }
      current.token = next?.token ?? "";
      setPreview(next);
      setReviewing(next?.candidates.length === 1);
      setSelected(
        next?.candidates.length === 1 ? (next.candidates[0]?.path ?? "") : "",
      );
    } catch (reason) {
      if (current.active) showError(reason);
    } finally {
      pending.current = false;
      if (current.active) setLoading(false);
    }
  }
  async function dismiss() {
    if (blocked || pending.current || !preview) return;
    pending.current = true;
    setDiscarding(true);
    try {
      await imports?.discard(preview.token);
      lifetime.current.token = "";
      setPreview(null);
      setNotice(null);
    } catch (reason) {
      showError(reason);
    } finally {
      pending.current = false;
      setDiscarding(false);
    }
  }
  async function close() {
    if (blocked || pending.current) return;
    pending.current = true;
    setDiscarding(true);
    try {
      if (lifetime.current.token)
        await imports?.discard(lifetime.current.token);
      lifetime.current.token = "";
      setPreview(null);
      errorTrigger.current = null;
      setError(null);
      setNotice(null);
      setDragging(false);
      setOpen(false);
    } catch (reason) {
      showError(reason);
    } finally {
      pending.current = false;
      setDiscarding(false);
    }
  }
  const candidate = preview?.candidates.find((p) => p.path === selected);
  const existing = catalog.plugins.find(
    (p) => p.manifest.id === candidate?.manifest.id,
  );
  const rollbackNotice =
    candidate?.publisher && existing && !existing.hasSignature
      ? "You cannot roll back to the unsigned revision after this update."
      : candidate?.revision === existing?.revision &&
          existing?.rollbackBlockedReason
        ? `${existing.rollbackBlockedReason}.`
        : existing?.previous || existing?.revision !== candidate?.revision
          ? "You can still roll back."
          : "There is no earlier revision to roll back to.";
  const declaredGrants = candidate ? hostGrants(candidate.manifest) : [];
  const previousGrants = existing ? hostGrants(existing.manifest) : [];
  const packageContent = candidate
    ? [
        contentChange(
          "README.md",
          candidate.readmeRevision,
          existing?.readmeRevision,
          !!existing,
        ),
        contentChange(
          "icon.png",
          candidate.iconPngRevision,
          existing?.iconPngRevision,
          !!existing,
        ),
        contentChange(
          "icon.jpg",
          candidate.iconJpgRevision,
          existing?.iconJpgRevision,
          !!existing,
        ),
      ].filter((value) => value !== null)
    : [];
  const addButton = (
    <Button
      ref={trigger}
      size="sm"
      disabled={blocked}
      onClick={() => setOpen(true)}
    >
      Add
    </Button>
  );
  return (
    <>
      {actionTarget ? createPortal(addButton, actionTarget) : addButton}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) void close();
        }}
        title="Add a plugin"
        description={
          error
            ? undefined
            : "Load built plugins containing manifest.json and plugin.js. Buzz doesn’t build source code or run install scripts. Only load code you trust: plugins aren’t sandboxed."
        }
        size={error ? "default" : "wide"}
        actions={
          error ? (
            <Button
              ref={errorBack}
              type="button"
              disabled={blocked}
              onClick={() => setError(null)}
            >
              Back
            </Button>
          ) : preview ? (
            <>
              <Button
                ref={previewBack}
                type="button"
                disabled={blocked}
                onClick={() => {
                  if (reviewing && preview.candidates.length > 1) {
                    setReviewing(false);
                    setNotice(null);
                  } else void dismiss();
                }}
              >
                Back
              </Button>
              {!reviewing && preview.candidates.length > 1 && (
                <Button
                  variant="prominent"
                  type="button"
                  disabled={blocked || !candidate}
                  onClick={() => setReviewing(true)}
                >
                  Continue
                </Button>
              )}
              {reviewing && candidate && (
                <Button
                  ref={installButton}
                  variant="prominent"
                  type="button"
                  disabled={blocked}
                  onClick={async () => {
                    const current = lifetime.current;
                    setError(null);
                    setNotice(null);
                    const success = await plugins.installImport(
                      preview.token,
                      candidate.path,
                    );
                    if (!current.active) return;
                    if (success)
                      setNotice(
                        `${candidate.manifest.name} installed. Use Back to choose another folder, or close this dialog.`,
                      );
                    else
                      showError(
                        plugins.snapshot().error ??
                          "Plugin installation wasn’t confirmed. Check the preview and try again.",
                      );
                  }}
                >
                  {existing ? "Update plugin" : "Install plugin"}
                </Button>
              )}
            </>
          ) : undefined
        }
        dismissOnOutsideClick
        preventClose={blocked}
        finalFocus={trigger}
      >
        {error && (
          <p role="alert" className="error break-words">
            {error}
          </p>
        )}
        <div hidden={!!error}>
          <div hidden={!!preview}>
            <div className={styles.columns}>
              <section
                aria-label="Add from folder"
                className={styles.folder}
                data-dragging={dragging || undefined}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes("Files")) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = blocked ? "none" : "copy";
                  setDragging(!blocked);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragging(false);
                  const items = Array.from(event.dataTransfer.items);
                  const entry =
                    items.length === 1 ? items[0]?.webkitGetAsEntry?.() : null;
                  const current = lifetime.current;
                  void load(async () => {
                    if (!entry?.isDirectory)
                      throw new Error("Drop one folder, or choose Browse.");
                    const upload = await readPluginFolder(entry);
                    if (!current.active) return null;
                    const next = await imports.files(
                      upload.source,
                      upload.files,
                    );
                    return next
                      ? {
                          ...next,
                          warnings: [...upload.warnings, ...next.warnings],
                        }
                      : null;
                  });
                }}
              >
                <FolderOpenIcon size={32} aria-hidden="true" />
                <p className="m-0 text-body-sm">Drop a plugin folder here</p>
                <Button
                  size="sm"
                  ref={browse}
                  aria-label="Browse plugin folder"
                  disabled={blocked}
                  onClick={() => void load(imports.folder)}
                >
                  Browse
                </Button>
              </section>
              <form
                aria-label="Add from Git"
                className={styles.git}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (repository.trim())
                    void load(async () => {
                      const signed = await authorizeGit?.(repository);
                      return signed
                        ? imports.git(
                            signed.repository,
                            reference,
                            signed.token,
                          )
                        : imports.git(repository, reference);
                    });
                }}
              >
                <SettingsGroup layout="form">
                  <Field label="Git or GitHub repository">
                    <Input
                      required
                      value={repository}
                      disabled={blocked}
                      placeholder="https://github.com/owner/repository"
                      onChange={(event) => setRepository(event.target.value)}
                    />
                  </Field>
                  <Field label="Branch or tag (optional)">
                    <Input
                      value={reference}
                      disabled={blocked}
                      placeholder="Repository default"
                      onChange={(event) => setReference(event.target.value)}
                    />
                  </Field>
                  <p className="m-0 text-caption text-muted">
                    HTTPS or SSH; GitHub owner/repository also works. SSH uses
                    your agent and known hosts. Password prompts and credential
                    helpers are not used. Buzz git repositories in this
                    community sign in with your account.
                  </p>
                  <div className="justify-self-start">
                    <Button
                      type="submit"
                      size="sm"
                      aria-label="Find plugins"
                      disabled={blocked || !repository.trim()}
                    >
                      Find
                    </Button>
                  </div>
                </SettingsGroup>
              </form>
            </div>
          </div>
          {loading && (
            <p role="status">
              Reading plugin folders… Git imports may take up to a minute.
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {preview && (
            <section ref={previewRegion} aria-label="Plugin import preview">
              {reviewing && candidate && (
                <Header
                  level={3}
                  title={candidate.manifest.name}
                  icon={<SquaresFourIcon size={24} />}
                  subtitle={
                    <>
                      {candidate.manifest.description && (
                        <span className="mb-1 block break-words">
                          {candidate.manifest.description}
                        </span>
                      )}
                      <span className="block break-all text-caption text-muted">
                        {candidate.manifest.id}
                      </span>
                      <span className="block break-all text-caption text-muted">
                        Source: {importLocation(preview, candidate.path)}
                      </span>
                      {preview.commit && (
                        <span className="block break-all text-caption text-muted">
                          Commit: {preview.commit}
                        </span>
                      )}
                    </>
                  }
                />
              )}
              <SettingsGroup layout="form">
                {!reviewing && (
                  <div className="min-w-0 text-body-sm">
                    <p className="m-0 break-all text-caption text-muted">
                      Source: {preview.source}
                    </p>
                    {preview.commit && (
                      <p className="m-0 break-all text-caption text-muted">
                        Commit: {preview.commit}
                      </p>
                    )}
                  </div>
                )}
                {preview.candidates.length === 0 ? (
                  <p className="m-0">
                    No built plugins found. Build the plugin first, then choose
                    its output folder, or use a repository that includes built
                    artifacts.
                  </p>
                ) : !reviewing && preview.candidates.length > 1 ? (
                  <Field label="Choose a plugin folder">
                    <RadioGroup
                      name="plugin-folder"
                      value={selected}
                      disabled={busy}
                      onValueChange={(value) => {
                        setSelected(value);
                        setNotice(null);
                      }}
                    >
                      {preview.candidates.map((item) => (
                        <Radio
                          key={item.path}
                          value={item.path}
                          variant="card"
                          label={item.manifest.name}
                          description={
                            <span className="break-all">
                              {item.path} · {item.manifest.id}
                            </span>
                          }
                        />
                      ))}
                    </RadioGroup>
                  </Field>
                ) : null}
                {preview.warnings.length > 0 &&
                  (!reviewing || preview.candidates.length === 1) && (
                    <section
                      aria-label="Skipped folders"
                      className="text-body-sm"
                    >
                      <p className="m-0 text-label">
                        Folders skipped ({preview.warnings.length})
                      </p>
                      <p className="mb-0 mt-1 text-muted">
                        These folders couldn’t be loaded as plugins. Other
                        listed plugins can still be installed.
                      </p>
                      <ul className="mb-0 mt-2 list-disc space-y-1 break-words pl-4">
                        {preview.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                {reviewing && packageContent.length > 0 && (
                  <section
                    aria-label="Package content"
                    className="text-body-sm"
                  >
                    <p className="m-0 font-medium">Package content</p>
                    <ul className="m-0">
                      {packageContent.map((description) => (
                        <li key={description}>{description}</li>
                      ))}
                    </ul>
                    <p className="m-0 text-caption text-muted">
                      Supplied by the plugin publisher; inclusion is not an
                      endorsement by Buzz.
                    </p>
                  </section>
                )}
                {reviewing && candidate && (
                  <section
                    aria-label="Computer access"
                    className="text-body-sm"
                  >
                    <p className="m-0 font-medium">Computer access</p>
                    {declaredGrants.length ? (
                      <>
                        <p className="m-0">This plugin asks Buzz to:</p>
                        <ul className="my-2 list-disc space-y-1 break-words pl-4">
                          {candidate.manifest.host?.commands?.map((command) => (
                            <li key={command.id}>
                              Run {command.program} on your computer.
                            </li>
                          ))}
                          {candidate.manifest.host?.processes?.map(
                            (process) => (
                              <li key={process.id}>
                                Start {process.program} with additional
                                arguments, using your account’s full access.
                              </li>
                            ),
                          )}
                          {candidate.manifest.host?.networkOrigins?.map(
                            (origin) => (
                              <li key={origin}>
                                Make web requests to {origin}.
                              </li>
                            ),
                          )}
                          {candidate.manifest.host?.mcp && (
                            <li>Provide tools to local agents.</li>
                          )}
                        </ul>
                      </>
                    ) : (
                      <p className="m-0">No computer access declared.</p>
                    )}
                    <p className="m-0 text-caption text-muted">
                      Plugins aren’t sandboxed. This list doesn’t describe
                      everything they may access.
                    </p>
                    {existing &&
                      (declaredGrants.some(
                        (grant) => !previousGrants.includes(grant),
                      ) ||
                        previousGrants.some(
                          (grant) => !declaredGrants.includes(grant),
                        )) && (
                        <p className="m-0">
                          Computer access changes with this update. Review the
                          technical details below.
                        </p>
                      )}
                    {(declaredGrants.length > 0 ||
                      previousGrants.length > 0) && (
                      <Accordion
                        key={selected}
                        items={[
                          {
                            value: "host-access",
                            title: "Technical details",
                            content: (
                              <section
                                aria-label="Plugin technical details"
                                // biome-ignore lint/a11y/noNoninteractiveTabindex: Scroll owner supports keyboard access to long command details.
                                tabIndex={0}
                                className={styles.technicalDetails}
                              >
                                {declaredGrants.length > 0 && (
                                  <ul className="m-0 break-all">
                                    {declaredGrants.map((grant) => (
                                      <li key={grant}>
                                        <code>{grant}</code>
                                        {existing &&
                                        !previousGrants.includes(grant)
                                          ? " (new or changed)"
                                          : ""}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {existing &&
                                  previousGrants.filter(
                                    (grant) => !declaredGrants.includes(grant),
                                  ).length > 0 && (
                                    <p className="m-0 break-all">
                                      Removed:{" "}
                                      <code>
                                        {previousGrants
                                          .filter(
                                            (grant) =>
                                              !declaredGrants.includes(grant),
                                          )
                                          .join(", ")}
                                      </code>
                                    </p>
                                  )}
                              </section>
                            ),
                          },
                        ]}
                      />
                    )}
                  </section>
                )}
                {reviewing && candidate && (
                  <p className="m-0 text-body-sm">
                    {existing
                      ? `This replaces ${existing.manifest.name} (${existing.manifest.id}). ${existing.enabled ? "It stays on and may run immediately unless this launch is in safe mode." : "It stays off."} ${rollbackNotice}`
                      : "This plugin starts off. Turn it on in the list when you’re ready."}
                  </p>
                )}
              </SettingsGroup>
            </section>
          )}
        </div>
      </Dialog>
    </>
  );
}
