import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { MeSidebar } from "../../bundled/me/MeSidebar";
import { ChannelSidebar } from "../../features/channel-navigation/ChannelSidebar";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { Tabs } from "../../shared/design-system/ui/Tabs";
import styles from "../../bundled/channels/Channels.module.css";

import { useRelayConnection } from "../../features/relay/react";
import { relayPartition } from "../../features/relay/partition";
import { targetKey } from "../../features/navigation/targets";
import { readView, writeView } from "../../shared/view-state";

type Filter = "all" | "solo" | "multiplayer";
const filters = [
  { value: "all", label: "All", panelId: "sidebar-all" },
  { value: "solo", label: "Solo", panelId: "sidebar-solo" },
  {
    value: "multiplayer",
    label: "Team",
    panelId: "sidebar-multiplayer",
  },
] as const;

/** Filters the navigation inventory without replacing the current conversation. */
export function PrimarySidebar(props: ComponentProps<typeof ChannelSidebar>) {
  const connection = useRelayConnection(props.relay);
  const scope = connection.scope ?? "disconnected";
  return <ScopedSidebar {...props} key={scope} scope={scope} />;
}

function ScopedSidebar({
  scope,
  ...props
}: ComponentProps<typeof ChannelSidebar> & { scope: string }) {
  const attempt = useSyncExternalStore(
    props.navigator.subscribe,
    () => props.navigator.snapshot().attempt.id,
  );
  const [observedAttempt, setObservedAttempt] = useState(attempt);
  const [view, setView] = useState(() => {
    const saved = readView<{ filter?: unknown; location?: unknown } | null>(
      scope,
      "navigation-scope",
      null,
    );
    return {
      filter:
        saved?.filter === "solo" || saved?.filter === "multiplayer"
          ? saved.filter
          : ("all" as Filter),
      location:
        typeof saved?.location === "string" ? saved.location : undefined,
    };
  });
  const target = props.target;
  const local =
    "scope" in target &&
    target.scope &&
    relayPartition(target.scope.communityOrigin, target.scope.viewer) === scope;
  const destination = local
    ? target.kind === "conversation" ||
      (target.kind === "page" && target.pluginId === "buzz.channels")
      ? "multiplayer"
      : target.kind === "page" && target.pluginId === "buzz.me"
        ? "solo"
        : undefined
    : undefined;
  const location = destination ? targetKey(target) : undefined;
  // A deliberate filter change leaves the pane alone; only a new destination reveals its inventory.
  if (attempt !== observedAttempt) setObservedAttempt(attempt);
  if (
    destination &&
    location &&
    (view.location !== location || attempt !== observedAttempt)
  ) {
    setView({ filter: view.filter === "all" ? "all" : destination, location });
  }
  useEffect(() => {
    writeView(scope, "navigation-scope", view);
  }, [scope, view]);
  const filter = view.filter;
  const setFilter = (filter: Filter) => setView({ filter, location });
  const visibleFilter = props.meEnabled ? filter : "multiplayer";
  return (
    <ChannelSidebar
      {...props}
      {...(props.meEnabled ? { panelId: `sidebar-${visibleFilter}` } : {})}
      header={
        <>
          {props.meEnabled && (
            <div className={styles.sidebarControls}>
              <div className={styles.sidebarScope}>
                <Tabs
                  label="Navigation scope"
                  variant="segmented"
                  value={visibleFilter}
                  items={filters}
                  onValueChange={setFilter}
                />
              </div>
            </div>
          )}
          {props.children && (
            <div className={styles.destinations}>{props.children}</div>
          )}
        </>
      }
      showChannels={visibleFilter !== "solo"}
      solo={
        props.meEnabled && (
          <div
            className={styles.sidebarGroup}
            hidden={visibleFilter === "multiplayer"}
          >
            {visibleFilter === "all" && (
              <div className={styles.sidebarScopeLabel}>
                <InlineHeader
                  title={<span className="text-standard">Solo</span>}
                />
              </div>
            )}
            <MeSidebar
              showCreationShortcuts={false}
              relay={props.relay}
              navigator={props.navigator}
              target={props.target}
            />
          </div>
        )
      }
    >
      {visibleFilter === "all" && (
        <div className={styles.sidebarScopeLabel}>
          <InlineHeader title={<span className="text-standard">Team</span>} />
        </div>
      )}
    </ChannelSidebar>
  );
}
