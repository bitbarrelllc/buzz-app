import { Header, InlineHeader } from "../shared/design-system/ui/Header";
import { ToastNotice } from "../shared/design-system/ui/Toast";
import { Panel } from "../shared/design-system/ui/Panel";
import { NavigationItem } from "../shared/design-system/ui/NavigationItem";
import { NavigationSection } from "../shared/design-system/ui/NavigationSection";
import { Button } from "../shared/design-system/ui/Button";
import { IconButton } from "../shared/design-system/ui/IconButton";
import { Switch } from "../shared/design-system/ui/Switch";
import { ChoiceRow } from "../shared/design-system/ui/ChoiceRow";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { RecoveryScreen } from "./RecoveryScreen";
import styles from "./Settings.module.css";
import { CheckCircleIcon, XIcon } from "../shared/design-system/icons/index";
import type { PluginManager } from "../plugins/manager";
import type { PluginInfo } from "../plugins/types";
import type { Communities } from "../features/communities/service";
import { PluginImport } from "./PluginImport";
import { PluginReadme } from "./PluginReadme";
import { bundledReadmes } from "../bundled/readmes";
import type { Identity } from "../features/identity/service";
import { ProfileSettings } from "./ProfileSettings";

import type { Appearance } from "../shared/theme/service";
import { AppearanceSettings } from "./AppearanceSettings";
import { NotificationSettings } from "./NotificationSettings";
import type { NotificationsService } from "../features/notifications/service";
import type { ShortcutsService } from "../features/shortcuts/service";
import type { ShortcutBindings } from "../features/shortcuts/preferences";
import { ShortcutSettings } from "./ShortcutSettings";
import { DeveloperSettings } from "./DeveloperSettings";
import { ArchiveSettings } from "./ArchiveSettings";
import { AgentSettings } from "./AgentSettings";
import type { SettingsCards } from "../features/settings/service";
import { OwnedContribution } from "../plugins/OwnedContribution";
import type { Updates } from "../features/updates/updates";
import { UpdateSettings } from "../features/updates/UpdateSettings";
import { developerMode, settingsSections } from "./settings-sections";

const pluginCategoryDefinitions = [
  { id: "communication", label: "Communication" },
  { id: "productivity", label: "Productivity" },
  { id: "agents", label: "Agents" },
  {
    id: "developer-tools-and-integrations",
    label: "Developer tools & integrations",
  },
  { id: "people-and-communities", label: "People & communities" },
] as const;

function groupPlugins(plugins: readonly PluginInfo[]) {
  const known = new Map<string, PluginInfo[]>(
    pluginCategoryDefinitions.map(({ id }) => [id, []]),
  );
  const other: PluginInfo[] = [];
  for (const plugin of plugins) {
    const group = known.get(plugin.manifest.discovery?.category ?? "");
    (group ?? other).push(plugin);
  }
  return [
    ...pluginCategoryDefinitions.flatMap(({ id, label }) => {
      const entries = known.get(id) ?? [];
      return entries.length ? [{ id, label, plugins: entries }] : [];
    }),
    ...(other.length ? [{ id: "other", label: "Other", plugins: other }] : []),
  ];
}

function PluginProvenance({
  source,
  publisher,
  className,
}: {
  source: "bundled" | "external";
  publisher?: string | null | undefined;
  className?: string | undefined;
}) {
  return (
    <span className={`${styles.pluginProvenance} ${className ?? ""}`}>
      <span>
        {source === "bundled" ? "Buzz" : publisher || "Unknown author"}
      </span>
      {source === "bundled" && (
        <CheckCircleIcon size={14} strokeWidth={2.5} aria-hidden="true" />
      )}
    </span>
  );
}

function PluginDetails({
  plugin,
  failure,
  busy,
  plugins,
  onClose,
}: {
  plugin: PluginInfo;
  failure: string | null;
  busy: boolean;
  plugins: PluginManager;
  onClose(): void;
}) {
  // READMEs ship with Buzz; never attach one to an external plugin.
  const readme =
    plugin.source === "bundled" && bundledReadmes.get(plugin.manifest.id);
  return (
    <aside
      id="plugin-details"
      className={styles.pluginAside}
      aria-label={`${plugin.manifest.name} details`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className={styles.pluginAsideHeader}>
        <div className={styles.pluginAsideIdentity}>
          <h2>{plugin.manifest.name}</h2>
          {plugin.source === "bundled" ? (
            <span className={styles.pluginInstallBadge}>
              <CheckCircleIcon size={14} aria-hidden="true" />
              Made by Buzz
            </span>
          ) : (
            <PluginProvenance
              source={plugin.source}
              publisher={plugin.publisher}
            />
          )}
        </div>
        <IconButton
          aria-label="Close plugin details"
          size="sm"
          icon={<XIcon size={16} aria-hidden="true" />}
          onClick={onClose}
        />
      </div>
      {plugin.source === "external" && (
        <span className={styles.pluginInstallBadge}>
          <CheckCircleIcon size={14} aria-hidden="true" />
          Installed
        </span>
      )}
      {!readme && plugin.manifest.description && (
        <p className={styles.pluginAsideDescription}>
          {plugin.manifest.description}
        </p>
      )}
      <section
        className={styles.pluginAsideSection}
        aria-labelledby="plugin-status-title"
      >
        <h3 id="plugin-status-title">Status</h3>
        <div className={styles.pluginStatus}>
          <span>{plugin.enabled ? "Enabled" : "Disabled"}</span>
          {/* Channels is required and has no enable/disable control. */}
          {plugin.manifest.id === "buzz.channels" ? (
            <span className="text-caption text-secondary">Required</span>
          ) : (
            <Switch
              aria-label={`Enable ${plugin.manifest.name}`}
              checked={plugin.enabled}
              readOnly={busy}
              aria-disabled={busy}
              onClick={(event) => event.currentTarget.focus()}
              onCheckedChange={() => {
                if (busy) return;
                void plugins.change(
                  plugin.enabled ? "disable" : "enable",
                  plugin.manifest.id,
                );
              }}
            />
          )}
        </div>
      </section>
      {readme && (
        <section
          className={styles.pluginAsideSection}
          aria-labelledby="plugin-readme-title"
        >
          <h3 id="plugin-readme-title">About</h3>
          <PluginReadme text={readme} />
        </section>
      )}
      <section
        className={styles.pluginAsideSection}
        aria-labelledby="plugin-metadata-title"
      >
        <h3 id="plugin-metadata-title">Details</h3>
        <dl className={styles.pluginMetadata}>
          <div>
            <dt>Identifier</dt>
            <dd>
              <code>{plugin.manifest.id}</code>
            </dd>
          </div>
          <div>
            <dt>Plugin API</dt>
            <dd>{plugin.manifest.apiVersion}</dd>
          </div>
          {plugin.source === "external" && (
            <>
              <div>
                <dt>Revision</dt>
                <dd>
                  <code>{plugin.revision}</code>
                </dd>
              </div>
              <div>
                <dt>Signature</dt>
                <dd>{plugin.hasSignature ? "Signed" : "Unsigned"}</dd>
              </div>
              {plugin.publisher && (
                <div>
                  <dt>Publisher</dt>
                  <dd>
                    <code title={plugin.publisher}>{plugin.publisher}</code>
                  </dd>
                </div>
              )}
            </>
          )}
        </dl>
      </section>
      {failure && (
        <p role="alert" className="error text-body-sm">
          {failure}
        </p>
      )}
      <div className="actions items-center">
        {plugin.previous && (
          <Button
            type="button"
            disabled={busy || !!plugin.rollbackBlockedReason}
            onClick={() => plugins.change("rollback", plugin.manifest.id)}
          >
            Roll back
          </Button>
        )}
        {plugin.rollbackBlockedReason && (
          <span className="text-body-sm text-muted">
            {plugin.rollbackBlockedReason}
          </span>
        )}
        {plugin.reloadable && !plugin.enabled && (
          <Button
            type="button"
            disabled={busy}
            onClick={() => plugins.reload(plugin.manifest.id)}
          >
            Reload
          </Button>
        )}
        {plugin.source === "external" && (
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => plugins.change("remove", plugin.manifest.id)}
          >
            Delete
          </Button>
        )}
      </div>
    </aside>
  );
}

export function Settings({
  cards,
  plugins,
  communities,
  identity,
  appearance,
  shortcuts,
  shortcutBindings,
  notifications,
  updates,
  navigation,
  onSection,
  navigationPane = false,
}: {
  cards: SettingsCards;
  plugins: PluginManager;
  communities: Communities;
  identity?: Identity | undefined;
  appearance: Appearance;
  shortcuts: ShortcutsService;
  shortcutBindings: ShortcutBindings;
  notifications: NotificationsService;
  updates: Updates;
  navigation?:
    | import("../features/navigation/service").PageNavigation
    | undefined;
  onSection?: (section: string) => void;
  navigationPane?: boolean;
}) {
  useEffect(() => cards.retainVisibility(), [cards]);
  const contributed = useSyncExternalStore(cards.subscribe, cards.snapshot);
  const client = useSyncExternalStore(
    communities.subscribe,
    communities.snapshot,
  );
  const selectedCommunity = client.memberships.find(
    (membership) => membership.id === client.selected,
  );
  const { groups, sections, defaultSection } = useMemo(
    () => settingsSections(contributed, selectedCommunity),
    [contributed, selectedCommunity],
  );
  const [selected, setSelected] = useState(defaultSection);
  const requestedSection =
    navigation?.target.kind === "settings"
      ? (navigation.target.section ?? defaultSection)
      : undefined;
  useEffect(() => {
    if (
      requestedSection &&
      sections.some((section) => section.id === requestedSection)
    )
      setSelected(requestedSection);
    else if (!sections.some((section) => section.id === selected)) {
      setSelected(defaultSection);
      if (requestedSection === selected) onSection?.(defaultSection);
    }
  }, [defaultSection, onSection, requestedSection, selected, sections]);
  useEffect(() => {
    if (requestedSection === selected)
      navigation?.complete({ status: "opened" });
  }, [navigation, requestedSection, selected]);
  const { configuration, activation, busy, error, refreshError } =
    useSyncExternalStore(plugins.subscribe, plugins.snapshot);
  const ready = configuration.status === "ready" ? configuration : undefined;
  const catalog = ready?.catalog;
  const externalPluginsPaused = ready?.externalPluginsPaused;
  const pluginGroups = useMemo(
    () => groupPlugins(catalog?.plugins ?? []),
    [catalog?.plugins],
  );
  const [selectedPluginId, setSelectedPluginId] = useState<string>();
  const pluginTrigger = useRef<HTMLButtonElement>(null);
  const selectedPlugin = catalog?.plugins.find(
    (plugin) => plugin.manifest.id === selectedPluginId,
  );
  useEffect(() => {
    if (selectedPluginId && catalog && !selectedPlugin)
      setSelectedPluginId(undefined);
  }, [catalog, selectedPlugin, selectedPluginId]);
  const closePluginDetails = () => {
    pluginTrigger.current?.focus();
    setSelectedPluginId(undefined);
  };
  const selectedRunning = selectedPlugin
    ? activation[selectedPlugin.manifest.id]
    : undefined;
  const selectedFailure = selectedPlugin
    ? (selectedPlugin.error ??
      (selectedRunning?.revision === selectedPlugin.revision
        ? selectedRunning.error
        : null))
    : null;
  return (
    <div
      className={`${styles.root} ${navigationPane ? styles.navigationPane : ""}`}
    >
      <Panel
        aria-label={navigationPane ? "Settings" : undefined}
        aria-labelledby={navigationPane ? undefined : "settings-title"}
      >
        <div
          className={styles.layout}
          data-plugin-detail={
            selected === "plugins" && selectedPlugin ? "" : undefined
          }
        >
          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <h1 id="settings-title" className="m-0 text-label">
                Settings
              </h1>
            </div>
            <nav aria-label="Settings sections" className={styles.navigation}>
              {groups.map((group) => (
                <NavigationSection key={group.id} label={group.label}>
                  {group.sections.map(({ id, label, icon: Icon }) => (
                    <NavigationItem
                      label={label}
                      icon={Icon && <Icon aria-hidden="true" size={18} />}
                      selected={selected === id}
                      type="button"
                      key={id}
                      aria-current={selected === id ? "page" : undefined}
                      onClick={(event) => {
                        event.currentTarget.focus();
                        if (onSection) onSection(id);
                        else setSelected(id);
                      }}
                    />
                  ))}
                </NavigationSection>
              ))}
            </nav>
          </aside>
          <div className={`${styles.detail} buzz-settings-page`}>
            {navigationPane && <h1 className="sr-only">Settings</h1>}
            <div hidden={selected !== "notifications"}>
              <NotificationSettings
                notifications={notifications}
                active={selected === "notifications"}
              />
            </div>
            <div hidden={selected !== "appearance"}>
              <AppearanceSettings
                appearance={appearance}
                active={selected === "appearance"}
              />
            </div>
            <div hidden={selected !== "shortcuts"}>
              <ShortcutSettings
                shortcuts={shortcuts}
                bindings={shortcutBindings}
                plugins={plugins}
              />
            </div>
            <div hidden={selected !== "agents"}>
              <AgentSettings
                archive={
                  <ArchiveSettings
                    relay={communities.relay}
                    community={selectedCommunity?.name}
                    active={selected === "agents"}
                  />
                }
                active={selected === "agents"}
              />
            </div>
            <div hidden={selected !== "updates"}>
              <UpdateSettings
                updates={updates}
                active={selected === "updates"}
              />
            </div>
            {contributed.map(
              (card) =>
                selected === card.key && (
                  <OwnedContribution
                    key={card.key}
                    entry={card}
                    registry={cards}
                  >
                    {(entry, active) => {
                      const Card = entry.component;
                      return (
                        <Card
                          active={active}
                          {...(!card.group && selectedCommunity
                            ? { community: selectedCommunity }
                            : {})}
                        />
                      );
                    }}
                  </OwnedContribution>
                ),
            )}
            <div hidden={selected !== "profile"}>
              <ProfileSettings
                key={`${client.viewer}:${selectedCommunity?.id ?? "local"}`}
                communities={communities}
                community={selectedCommunity}
                identity={identity}
                active={selected === "profile"}
              />
            </div>
            {developerMode && (
              <div hidden={selected !== "developer"}>
                <DeveloperSettings relay={communities.relay} />
              </div>
            )}
            <div hidden={selected !== "plugins"}>
              <section aria-labelledby="plugin-settings-title">
                <Header
                  id="plugin-settings-title"
                  title="Plugins"
                  subtitle={
                    !plugins.imports
                      ? "Open the desktop app to load plugins from a folder or Git repository."
                      : undefined
                  }
                />
                {catalog ? (
                  <PluginImport
                    plugins={plugins}
                    catalog={catalog}
                    busy={busy}
                    authorizeGit={async (repository) => {
                      const connection = communities.relay.snapshot();
                      return connection.status === "ready"
                        ? ((await connection.session.authorizeGit?.(
                            repository,
                          )) ?? null)
                        : null;
                    }}
                  />
                ) : configuration.status === "recovery" ? (
                  <RecoveryScreen plugins={plugins} />
                ) : (
                  <p role="status">
                    Plugin settings are unavailable. Profile and Appearance
                    still work.
                  </p>
                )}
                <div>
                  <div>
                    {externalPluginsPaused && (
                      <p role="status" className="text-body-sm text-subtle">
                        External plugins are paused for this launch. Your saved
                        enabled settings are unchanged; you can still manage
                        plugins here.
                      </p>
                    )}
                    {selected === "plugins" && refreshError && (
                      <ToastNotice
                        title="Plugin settings couldn’t refresh"
                        description={`Showing the last available configuration; retrying automatically. ${refreshError}`}
                      />
                    )}
                    {selected === "plugins" && error && (
                      <ToastNotice
                        title="Plugin change wasn’t confirmed"
                        description={`Check the current settings before trying again. ${error}`}
                        onDismiss={plugins.dismissError}
                        closeLabel="Dismiss"
                      />
                    )}
                  </div>
                  <div className={styles.pluginCategories}>
                    {pluginGroups.map((group) => (
                      <section
                        aria-labelledby={`plugin-category-${group.id}`}
                        key={group.id}
                      >
                        <InlineHeader
                          id={`plugin-category-${group.id}`}
                          title={group.label}
                        />
                        <div className={styles.pluginList}>
                          {group.plugins.map((plugin) => {
                            const id = plugin.manifest.id;
                            const active = id === selectedPluginId;
                            return (
                              <article className={styles.plugin} key={id}>
                                <button
                                  ref={active ? pluginTrigger : undefined}
                                  type="button"
                                  className={styles.pluginRow}
                                  aria-label={`View ${plugin.manifest.name} details`}
                                  aria-expanded={active}
                                  aria-controls={
                                    active ? "plugin-details" : undefined
                                  }
                                  onClick={(event) => {
                                    pluginTrigger.current = event.currentTarget;
                                    setSelectedPluginId(
                                      active ? undefined : id,
                                    );
                                  }}
                                >
                                  <ChoiceRow
                                    label={plugin.manifest.name}
                                    description={plugin.manifest.description}
                                  />
                                  <PluginProvenance
                                    source={plugin.source}
                                    publisher={plugin.publisher}
                                    className={styles.pluginRowAuthor}
                                  />
                                </button>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
          {selected === "plugins" && selectedPlugin && (
            <PluginDetails
              plugin={selectedPlugin}
              failure={selectedFailure}
              busy={busy}
              plugins={plugins}
              onClose={closePluginDetails}
            />
          )}
        </div>
      </Panel>
    </div>
  );
}
