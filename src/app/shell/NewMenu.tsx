import { useRef, useState, useSyncExternalStore } from "react";
import type { Agents } from "../../features/agents/service";
import { CreateChannelDialog } from "../../bundled/channels/CreateChannelDialog";
import { expandSidebarSection } from "../../bundled/channels/useSidebarView";
import { useSidebarPreferences } from "../../bundled/channels/useSidebarPreferences";
import type { Navigation } from "../../features/navigation/controller";
import { useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import { splitPartition } from "../../features/relay/partition";
import { NewProject } from "../../features/sessions/NewProject";
import { resetNewChatProject } from "../../features/sessions/NewSessionComposer";
import { meTarget } from "../../bundled/me/routes";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import {
  MenuRoot,
  MenuTrigger,
  MenuPopup,
  MenuItem,
} from "../../shared/design-system/ui/Menu";
import styles from "../../bundled/channels/Channels.module.css";
import { PlusIcon } from "../../shared/design-system/icons";

type Props = {
  relay: RelayData;
  navigator: Navigation;
  meEnabled: boolean;
  agents?: Agents | undefined;
};

export function NewMenu(props: Props) {
  const connection = useRelayConnection(props.relay);
  return (
    <ReadyNewMenu
      {...props}
      key={connection.scope ?? "disconnected"}
      session={connection.session}
      available={connection.status === "ready" || !!connection.cached}
    />
  );
}

function ReadyNewMenu({
  relay,
  navigator,
  meEnabled,
  agents,
  session,
  available,
}: Props & { session: RelaySession; available: boolean }) {
  useSyncExternalStore(
    session.mePreferences.subscribe,
    session.mePreferences.snapshot,
  );
  const preferences = useSidebarPreferences(session.sidebarPreferences);
  const pendingChannel = useSyncExternalStore(
    session.channelCreation.subscribe,
    session.channelCreation.snapshot,
  );
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const scope = splitPartition(session.scope);
  const current = () => relay.snapshot().session === session;
  return (
    <>
      <MenuRoot>
        <MenuTrigger
          render={
            <IconButton
              ref={trigger}
              disabled={!available}
              aria-label="New"
              title="New"
              variant="ghost"
              shape="round"
              size="sm"
              icon={<PlusIcon className={styles.sidebarCreateIcon} size={18} />}
            />
          }
        />
        <MenuPopup>
          <MenuItem
            disabled={!meEnabled}
            onClick={() => {
              if (current()) void navigator.open(meTarget(session.scope));
            }}
          >
            New chat
          </MenuItem>
          <MenuItem
            disabled={
              !meEnabled || !session.mePreferences.sectionCreationWritable
            }
            onClick={() => {
              if (current()) setCreatingProject(true);
            }}
          >
            New project
          </MenuItem>
          <MenuItem
            disabled={!scope}
            onClick={() => {
              if (scope && current())
                void navigator.open({
                  version: 1,
                  kind: "page",
                  pluginId: "buzz.channels",
                  pageId: "channels",
                  scope,
                  route: { version: 1, params: "new-message" },
                });
            }}
          >
            New DM
          </MenuItem>
          <MenuItem
            disabled={!session.channelCreation.available}
            onClick={() => {
              if (current()) setCreatingChannel(true);
            }}
          >
            New channel
          </MenuItem>
        </MenuPopup>
      </MenuRoot>
      <CreateChannelDialog
        open={creatingChannel}
        onOpenChange={setCreatingChannel}
        session={session}
        agents={agents}
        finalFocus={trigger}
        pending={pendingChannel}
        destinations={preferences.data?.sections ?? []}
        initialGroup=""
        groupsReady={preferences.writable}
        onCreate={async (input) => {
          const channelId = await session.channelCreation.create(input);
          if (current() && scope) {
            expandSidebarSection(
              session.scope,
              input.setup?.starred
                ? "starred"
                : input.setup?.groupId
                  ? `group:${input.setup.groupId}`
                  : "channels",
            );
            void navigator.open({
              version: 1,
              kind: "conversation",
              channelId,
              scope,
            });
          }
        }}
      />
      {creatingProject && (
        <NewProject
          session={session}
          create={(section) => session.mePreferences.createSection(section)}
          close={() => setCreatingProject(false)}
          finalFocus={trigger}
          onCreated={(id) => {
            if (!current()) return;
            resetNewChatProject(session.scope, true, id);
            void navigator.open(meTarget(session.scope, "new", id));
          }}
        />
      )}
    </>
  );
}
