import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeLinkUrl } from "../features/relay/message-content";
import styles from "./PluginReadme.module.css";

const REMARK = [remarkGfm];
// The pane already titles the plugin (h2); README sections nest beneath it.
const MARKDOWN: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
  h4: ({ children }) => <h5>{children}</h5>,
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
