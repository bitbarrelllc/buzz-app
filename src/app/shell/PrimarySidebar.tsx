import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { MeSidebar } from "../../bundled/me/MeSidebar";
import { ChannelInventory } from "../../features/channel-navigation/ChannelInventory";
import { SidebarBoundary } from "../../features/channel-navigation/SidebarBoundary";
import { SidebarFrame } from "../../features/channel-navigation/SidebarFrame";
import { SidebarList } from "../../features/channel-navigation/SidebarList";
import { ResizableSidebar } from "../../features/channel-navigation/ResizableSidebar";
import { SidebarUnread } from "../../bundled/channels/SidebarUnread";
import { Button } from "../../shared/design-system/ui/Button";
import type { RelayData } from "../../features/relay/service";
import type { Agents } from "../../features/agents/service";
import type { Navigation } from "../../features/navigation/controller";
import type { OpenTarget } from "../../features/navigation/targets";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { Tabs } from "../../shared/design-system/ui/Tabs";
import styles from "./PrimarySidebar.module.css";

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

type Props = {
  relay: RelayData;
  navigator: Navigation;
  agents?: Agents | undefined;
  target: OpenTarget;
  meEnabled?: boolean | undefined;
  children: ReactNode;
};

/** Filters the navigation inventory without replacing the current conversation. */
export function PrimarySidebar(props: Props) {
  const connection = useRelayConnection(props.relay);
  const scope = connection.scope ?? "disconnected";
  return (
    <ScopedSidebar
      {...props}
      key={scope}
      scope={scope}
      connection={connection}
    />
  );
}

function ScopedSidebar({
  scope,
  connection,
  ...props
}: Props & {
  scope: string;
  connection: ReturnType<typeof useRelayConnection>;
}) {
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
  const panelId = props.meEnabled ? `sidebar-${visibleFilter}` : undefined;
  const header = (
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
  );
  const solo = props.meEnabled && (
    <div
      className={styles.sidebarGroup}
      hidden={visibleFilter === "multiplayer"}
    >
      {visibleFilter === "all" && (
        <div className={styles.sidebarScopeLabel}>
          <InlineHeader title={<span className="text-standard">Solo</span>} />
        </div>
      )}
      <MeSidebar
        relay={props.relay}
        navigator={props.navigator}
        target={props.target}
      />
    </div>
  );
  const teamLabel = visibleFilter === "all" && (
    <div className={styles.teamHeading}>
      <div className={styles.sidebarScopeLabel}>
        <InlineHeader title={<span className="text-standard">Team</span>} />
      </div>
    </div>
  );
  return (
    <SidebarBoundary
      key={`${scope}:${connection.generation}`}
      header={header}
      panelId={panelId}
    >
      {connection.status === "ready" || connection.cached ? (
        <ChannelInventory
          relay={props.relay}
          navigator={props.navigator}
          agents={props.agents}
          target={props.target}
          meEnabled={props.meEnabled}
          queries={connection.session}
          scope={scope}
          viewer={connection.viewer}
          cached={!!connection.cached}
          connectionError={connection.error}
          render={({
            sidebar,
            dmPreviews,
            frame,
            before,
            content,
            after,
            dialogs,
          }) => (
            <ResizableSidebar scope={scope} className="shell-sidebar">
              <SidebarFrame
                label="Sidebar"
                header={header}
                panelId={panelId}
                {...frame}
              >
                {before}
                <SidebarUnread listRef={sidebar.list} dmPreviews={dmPreviews}>
                  {solo}
                  <div
                    className={styles.sidebarGroup}
                    hidden={visibleFilter === "solo"}
                  >
                    {teamLabel}
                    {content}
                  </div>
                </SidebarUnread>
                {after}
              </SidebarFrame>
              {dialogs}
            </ResizableSidebar>
          )}
        />
      ) : (
        <div className="shell-sidebar-default">
          <SidebarFrame
            label="Sidebar"
            header={header}
            panelId={panelId}
            launchPending={
              connection.status === "connecting" ? "required" : undefined
            }
          >
            <SidebarList>
              {solo}
              <div hidden={visibleFilter === "solo"}>{teamLabel}</div>
              <p className={styles.connectionMessage}>
                {connection.status === "connecting"
                  ? "Connecting to your relay…"
                  : (connection.error ?? "Choose a community to see channels.")}
              </p>
              {connection.status === "error" && (
                <Button onClick={props.relay.retry}>Retry channels</Button>
              )}
            </SidebarList>
          </SidebarFrame>
        </div>
      )}
    </SidebarBoundary>
  );
}
