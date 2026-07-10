import { useEffect, useState } from "react";
import { EdodoWriteEditor } from "../lib/react.js";
import { highlight, callout, math, edodoDraw, tags, embeds } from "../plugins/index.js";
import "katex/dist/katex.min.css";
import { EXAMPLES } from "./examples.js";

// Plugins are captured when the editor mounts; the editor remounts (via key)
// on every example switch, so one shared instance list is fine.
const DEMO_TAGS = [
  { label: "roadmap", href: "https://github.com/vivmagarwal/edodo-write/issues" },
  { label: "editor", href: "https://github.com/vivmagarwal/edodo-write" },
  { label: "markdown" },
  { label: "diagrams", href: "https://github.com/vivmagarwal/edododraw" },
];
const PLUGINS = [
  highlight(),
  callout(),
  math(),
  edodoDraw(),
  tags({
    source: (query: string) =>
      DEMO_TAGS.filter((t) => t.label.startsWith(query.toLowerCase())),
  }),
  embeds(),
];

type Theme = "light" | "dark" | "system";

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const el = document.documentElement.dataset.theme;
    return el === "light" || el === "dark" ? el : "system";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("ew.theme", theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, setTheme];
}

export function Site() {
  const [markdown, setMarkdown] = useState(EXAMPLES[0].markdown);
  const [activeExample, setActiveExample] = useState(EXAMPLES[0].id);
  const [theme, setTheme] = useTheme();
  const cycleTheme = () => setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");

  const loadExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setActiveExample(id);
    setMarkdown(ex.markdown);
  };

  return (
    <div className="site">
      <header className="site__header">
        <div className="site__brand">
          <span className="site__logo">✎</span>
          <div>
            <h1>edodo-write</h1>
            <p>A Markdown-native Notion / Medium editor</p>
          </div>
        </div>
        <nav className="site__nav">
          <button className="site__theme" onClick={cycleTheme} title="Toggle theme">
            {theme === "light" ? "☀︎ Light" : theme === "dark" ? "☾ Dark" : "◐ System"}
          </button>
          <a href="https://www.npmjs.com/package/edodo-write" target="_blank" rel="noreferrer">npm</a>
          <a href="https://github.com/vivmagarwal/edodo-write" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <div className="site__examples">
        <span>Examples:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            className={ex.id === activeExample ? "is-active" : ""}
            onClick={() => loadExample(ex.id)}
          >
            {ex.label}
          </button>
        ))}
      </div>

      <main className="site__main">
        <section className="site__pane">
          <div className="site__pane-head">Editor</div>
          <div className="site__editor">
            <EdodoWriteEditor
              key={activeExample}
              value={markdown}
              onChange={setMarkdown}
              plugins={PLUGINS}
              autofocus
              ariaLabel="Demo editor"
            />
          </div>
        </section>

        <section className="site__pane site__pane--out">
          <div className="site__pane-head">Markdown (the value you'd store)</div>
          <pre className="site__markdown">{markdown || " "}</pre>
        </section>
      </main>

      <footer className="site__footer">
        <code>npm i edodo-write</code>
        <span>·</span>
        <span>MIT</span>
        <span>·</span>
        <a href="https://vivmagarwal.github.io/edodo-write/" target="_blank" rel="noreferrer">docs & demo</a>
      </footer>
    </div>
  );
}
