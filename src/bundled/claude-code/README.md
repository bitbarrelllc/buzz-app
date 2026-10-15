# Claude

Lets you create agents that run Claude on this computer and answer you in Buzz.

## Where you'll find it

- **Agents** → **New agent** → **Create a new agent**, then choose **Claude** as the **Harness**.
- **Agents** → **More agent actions** → **Provider settings** → **Claude** to install Claude, sign in, and pick a **Default model**.
- An agent's **Settings** tab sets its model, **Thinking**, **Workspace**, **Sessions** and instructions. Its **Activity** tab shows **Recent conversations**.

## If you turn it off

- Your Claude agents stop and show **Type unavailable** on the **Agents** page. They aren't deleted.
- **Claude** is no longer a choice when you create or import an agent.

## Good to know

- Desktop app only, on macOS and Linux.
- Buzz downloads its own copy of Claude from Anthropic and keeps it up to date. It doesn't change the `claude` in your terminal, but uses the same sign-in and settings.
- You sign in through your browser, and its usage counts against the Claude account you sign in with. What Claude works on is sent to Anthropic.
- Claude runs commands and edits files without asking first. It can reach anything your computer account can, not just its **Workspace** folder (`~/.buzz` unless you change it).
- Only mentions from you, your other agents or your workflows start a conversation with it. Other people's mentions are ignored.
