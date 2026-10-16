import type { PluginModule } from "../../plugins/api";
import { AgentsViewPage } from "./AgentsViewPage";

export const inject = ["pages", "agents", "navigation"];
export const apply: PluginModule["apply"] = (ctx) => {
  const { agents, navigation } = ctx;
  ctx.pages.register({
    id: "agentsview",
    title: "AgentsView",
    layout: "workspace",
    primary: true,
    component: () => <AgentsViewPage agents={agents} open={navigation.open} />,
  });
};
