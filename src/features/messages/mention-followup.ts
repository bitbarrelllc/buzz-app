import { knownAgentPubkeys } from "../agents/known";
import type { ComposerSession } from "./composer-session";
import { archivedMention } from "./mention-admission";
import { followupDraft, type MentionDraft } from "./mention-draft";
import { rememberAgentsPreference } from "./mention-preferences";

/** Both the editor and its detached-window owner preserve only notified agents. */
export function sentMentionFollowup(
  session: ComposerSession,
  captured: MentionDraft,
  recipients: readonly string[],
) {
  const agents = knownAgentPubkeys(
    session.profiles.snapshot(),
    session.agentChoices.snapshot(),
  );
  return followupDraft(
    rememberAgentsPreference()
      ? captured.recipients.filter(
          (item) =>
            agents.has(item.pubkey) &&
            recipients.includes(item.pubkey) &&
            !archivedMention(session, item.pubkey),
        )
      : [],
  );
}
