import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { RelaySession } from "../../features/relay/session";
import type { ConversationExtensions } from "../../features/conversation/contracts";
import type { ConversationHostServices } from "../../features/conversation/ConversationHost";
import {
  buzzLinkTarget,
  isBuzzLink,
} from "../../features/navigation/buzz-links";
import { useChannelList } from "../../features/relay/react";
import { channelIcon } from "../../features/channels/channel-icon";
import { PanelWorkspace } from "../../features/panels/PanelWorkspace";
import { PanelDock } from "../../features/panels/PanelDock";
import { usePanelSplit } from "../../features/panels/usePanelSplit";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { SidebarRightIcon } from "../../shared/design-system/icons";
import panelStyles from "../../features/panels/Panels.module.css";
import { useChannelLabels } from "./useChannelLabels";
import { useChannelTabState } from "./useChannelTabState";
import { useConversationTabs } from "./useConversationTabs";
import styles from "./Channels.module.css";

export type PageTabTarget = { channelId: string; threadId?: string };
export type PageTabsProps = {
  /** Keys the page's tabs, which last as long as its community session. */
  id: string;
  session: RelaySession;
  scope: string;
  label: string;
  icon?: ReactNode;
  /** The page's own first tab. `open` adds a host tab for a joined conversation. */
  children(open: (target: PageTabTarget) => boolean): ReactNode;
};

/** A page's content as the first tab, with conversations it opens beside it. */
export function PageTabs({
  id,
  session,
  scope,
  label,
  icon,
  children,
  host,
  extensions,
}: PageTabsProps & {
  host: ConversationHostServices;
  extensions: ConversationExtensions;
}) {
  const tabState = useChannelTabState(session, undefined, `page:${id}`);
  const list = useChannelList(session.channels);
  const { channels } = useChannelLabels(
    list.channels,
    session.profiles,
    session.names,
  );
  const continuing = useRef(false);
  useLayoutEffect(() => {
    continuing.current = true;
  }, []);
  const fallbackFocus = useRef<HTMLDivElement>(null);
  const secondary = useConversationTabs({
    state: tabState,
    relay: host.relay,
    session,
    panels: host.panels,
    current: undefined,
    scope,
    channels,
    extensions,
    leadingIds: [],
    continuingVisit: continuing.current,
    isLive: () => true,
    openLink(url) {
      const viewer = session.viewer;
      const target =
        viewer &&
        isBuzzLink(url) &&
        buzzLinkTarget(url, {
          viewer,
          communityOrigin: scope.slice(0, -(viewer.length + 1)),
        });
      if (!target) return false;
      void host.navigation.open(target);
      return true;
    },
    fallbackFocus,
    mainPane: true,
    conversationIcon: (item) => {
      const Icon = channelIcon(item);
      return <Icon size="1rem" />;
    },
  });
  const open = ({ channelId, threadId }: PageTabTarget) => {
    if (!channels.some((channel) => channel.id === channelId)) return false;
    if (threadId) {
      secondary.openConversationThread(channelId, threadId, threadId);
      return true;
    }
    const tab = `conversation:${channelId}`;
    tabState.setTabs((tabs) =>
      tabs.some((item) => item.id === tab)
        ? tabs
        : [...tabs, { id: tab, kind: "conversation", channelId }],
    );
    tabState.select(tab);
    return true;
  };
  const split = usePanelSplit();
  const hasTabs = secondary.items.length > 0;
  const showingPanel = tabState.paneOpen && hasTabs;
  const tabMenu = {
    key: JSON.stringify([scope, id]),
    closeAll: secondary.closeAllTabs,
  };
  const paneToggle = (ref?: typeof secondary.splitTrigger) => (
    <IconButton
      ref={ref}
      data-tab-pane-toggle=""
      size="toolbar"
      aria-label="Toggle tab pane"
      title={showingPanel ? "Close tab pane" : "Open tab pane"}
      aria-expanded={showingPanel}
      onClick={() => tabState.setPaneOpen(!showingPanel)}
      icon={<SidebarRightIcon size="1rem" aria-hidden="true" />}
    />
  );
  return (
    <div className={styles.root}>
      <div ref={split.ref} style={split.style} className={styles.board}>
        <div ref={fallbackFocus} tabIndex={-1} className={styles.conversation}>
          <PanelWorkspace
            main
            tabMenu={tabMenu}
            drag={secondary.drag.main}
            label={`${label} tabs`}
            focusOnMount={false}
            value={secondary.selectedMain}
            select={(tab) =>
              tabState.selectMain(tab === "conversation" ? undefined : tab)
            }
            actions={
              hasTabs &&
              !showingPanel && (
                <span className={panelStyles.paneToggle}>
                  {paneToggle(secondary.splitTrigger)}
                </span>
              )
            }
            items={[
              { id: "conversation", label, icon, content: children(open) },
              ...secondary.mainItems,
            ]}
          />
        </div>
        {secondary.drag.feedback}
        {secondary.hosts}
        <p role="status" className="sr-only">
          {secondary.announcement}
        </p>
        <PanelDock
          open={showingPanel}
          keepMounted={hasTabs && !tabState.paneOpen}
          className={styles.panelStack}
          resizeHandle={split.handle}
        >
          {hasTabs && (
            <div className={styles.retainedPanel}>
              <PanelWorkspace
                drag={secondary.drag.side}
                actions={paneToggle()}
                tabMenu={tabMenu}
                value={secondary.selectedTab}
                select={secondary.selectPanelTab}
                items={secondary.items}
                focusOnMount={continuing.current}
              />
            </div>
          )}
        </PanelDock>
      </div>
    </div>
  );
}
