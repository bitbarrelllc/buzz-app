import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeLinkUrl } from "../features/relay/message-content";
import styles from "./PluginReadme.module.css";

const REMARK = [remarkGfm];
// The details pane titles the plugin (h2) and its sections (h3). A README
// opens with the plugin's name, which the pane already shows; later headings
// drop two levels so its sections nest under About.
const MARKDOWN: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h4>{children}</h4>,
  h3: ({ children }) => <h5>{children}</h5>,
  h4: ({ children }) => <h6>{children}</h6>,
  h5: ({ children }) => <h6>{children}</h6>,
  h6: ({ children }) => <h6>{children}</h6>,
  // Relative and in-page links have nowhere to go outside the repository.
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      children
    ),
  img: ({ alt }) => alt ?? null,
};

export function PluginReadme({ text }: { text: string }) {
  return (
    <div className={styles.readme}>
      <Markdown
        remarkPlugins={REMARK}
        components={MARKDOWN}
        skipHtml
        urlTransform={(url) => safeLinkUrl(url) ?? null}
      >
        {text.replace(/^# .*\n+/, "")}
      </Markdown>
    </div>
  );
}
