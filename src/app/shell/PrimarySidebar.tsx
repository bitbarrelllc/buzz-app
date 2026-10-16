import { useState, type ComponentProps } from "react";
import { MeSidebar } from "../../bundled/me/MeSidebar";
import { ChannelSidebar } from "../../features/channel-navigation/ChannelSidebar";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { Tabs } from "../../shared/design-system/ui/Tabs";
import styles from "../../bundled/channels/Channels.module.css";

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
  const [filter, setFilter] = useState<Filter>("all");
  const visibleFilter = props.meEnabled ? filter : "multiplayer";
  return (
    <ChannelSidebar
      {...props}
      panelId={`sidebar-${visibleFilter}`}
      header={
        <>
          <div className={styles.sidebarControls}>
            <div className={styles.sidebarScope}>
              <Tabs
                label="Navigation scope"
                variant="segmented"
                value={visibleFilter}
                items={
                  props.meEnabled
                    ? filters
                    : filters.filter((item) => item.value === "multiplayer")
                }
                onValueChange={setFilter}
              />
            </div>
          </div>
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
