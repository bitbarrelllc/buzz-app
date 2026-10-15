# Workflows

Workflows automate work in a channel: when something happens, like a new message or a scheduled time, the relay runs the steps you set up.

## Where you'll find it

- **Workflows** in the sidebar. Choose **New workflow** to create one in a channel.
- Start a workflow with **Message posted**, **Reaction added**, **Diff posted**, **Schedule**, or **Webhook**, then add **Send Message**, **Delay**, or **Call Webhook** steps.

## If you turn it off

- The Workflows page goes away, but your saved workflows keep running, because the relay runs them, not this app. To stop a workflow, turn it off or delete it before you turn off the plugin.

## Good to know

- New workflows start turned off. Buzz asks you to confirm before turning one on, since it can run as soon as its trigger matches.
- People in the channel can view your workflow's full setup, including webhook URLs, headers, and request bodies. Don't put passwords or tokens there.
- Only the author can change a workflow. Everyone else sees it read-only.
- Schedules use UTC.
- A webhook trigger's secret is shown once and can't be recovered, so copy it when it appears.
