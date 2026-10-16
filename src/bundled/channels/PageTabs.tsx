import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { RelaySession } from "../../features/relay/session";
import type { ConversationExtensions } from "../../features/conversation/contracts";
import type { ConversationHostServices } from "../../features/conversation/ConversationHost";
import {
  buzzLinkTarget,
  isBuzzLink,
} from "../../features/navigation/buzz-links";
import { LinkThreadTabContext } from "../../features/conversation/LinkLabelContext";
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
  const mounted = useRef(false);
  const continuing = useRef(false);
  useLayoutEffect(() => {
    mounted.current = continuing.current = true;
    return () => {
      mounted.current = false;
    };
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
  // One stable opener, so a page's effects can depend on it; it reads the
  // live workspace when called.
  const opening = useRef<(target: PageTabTarget) => boolean>(() => false);
  useLayoutEffect(() => {
    opening.current = ({ channelId, threadId }) => {
      if (!mounted.current || !secondary.canOpenConversation(channelId))
        return false;
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
  });
  const open = useCallback(
    (target: PageTabTarget) => opening.current(target),
    [],
  );
  const focusPage = useRef(false);
  const closeAll = () => {
    if (!secondary.closeAllTabs()) return false;
    focusPage.current = true;
    return true;
  };
  // The page owns the close-all command while its workspace is shown.
  useLayoutEffect(() => {
    const close = (event: Event) => {
      const workspace = fallbackFocus.current;
      if (
        event.defaultPrevented ||
        !workspace?.isConnected ||
        workspace.closest('[hidden], [inert], [aria-hidden="true"]') ||
        !workspace.getClientRects().length ||
        document.querySelector('dialog[open], [aria-modal="true"]')
      )
        return;
      flushSync(() => {
        if (closeAll()) event.preventDefault();
      });
    };
    window.addEventListener("buzz:close-all-tabs", close);
    return () => window.removeEventListener("buzz:close-all-tabs", close);
  });
  // Surviving content keeps focus; a removed tab or closing menu returns it
  // to the page's own tab.
  useLayoutEffect(() => {
    if (!focusPage.current) return;
    focusPage.current = false;
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      focused !== document.body &&
      focused.isConnected &&
      !focused.closest('[inert], [hidden], [aria-hidden="true"], [role="menu"]')
    )
      return;
    (
      fallbackFocus.current?.querySelector<HTMLElement>(
        '[role="tab"][data-tab-value="conversation"]',
      ) ?? fallbackFocus.current
    )?.focus({ preventScroll: true });
  });
  const split = usePanelSplit();
  const hasTabs = secondary.items.length > 0;
  const showingPanel = tabState.paneOpen && hasTabs;
  const tabMenu = {
    key: JSON.stringify([scope, id]),
    closeAll,
  };
  const paneToggle = (
    onClick: () => void,
    ref?: typeof secondary.splitTrigger,
  ) => (
    <IconButton
      ref={ref}
      data-tab-pane-toggle=""
      size="toolbar"
      aria-label="Toggle tab pane"
      title={showingPanel ? "Close tab pane" : "Open tab pane"}
      aria-expanded={showingPanel}
      onClick={onClick}
      icon={<SidebarRightIcon size="1rem" aria-hidden="true" />}
    />
  );
  return (
    <LinkThreadTabContext value={secondary.openLinkedThread}>
      <div className={styles.root}>
        <div ref={split.ref} style={split.style} className={styles.board}>
          <div
            ref={fallbackFocus}
            tabIndex={-1}
            className={styles.conversation}
          >
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
                    {paneToggle(
                      () => tabState.setPaneOpen(true),
                      secondary.splitTrigger,
                    )}
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
                  actions={paneToggle(secondary.closePane)}
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
    </LinkThreadTabContext>
  );
}
