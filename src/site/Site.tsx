import { useEffect, useRef, useState } from "react";
import { EdodoWriteEditor, Markdown } from "../lib/react.js";
import type { EdodoWrite } from "../lib/react.js";
import {
  highlight, callout, math, edodoDraw, tags, embeds,
  emoji, footnote, file, detailsToggle,
} from "../plugins/index.js";
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
const DEMO_PEOPLE = [
  { label: "vivek", href: "https://github.com/vivmagarwal", hint: "Vivek Agarwal" },
  { label: "dodo-bot", href: "https://github.com/vivmagarwal/edodo-write", hint: "Automation bot" },
];
const topicTags = () =>
  tags({
    source: (query: string) =>
      DEMO_TAGS.filter((t) => t.label.startsWith(query.toLowerCase())),
  });
const mentionTags = () =>
  tags({
    name: "mentions",
    trigger: "@",
    source: (query: string) =>
      DEMO_PEOPLE.filter((t) => t.label.startsWith(query.toLowerCase())),
  });

const PLUGINS = [
  highlight(),
  callout(),
  math(),
  edodoDraw(),
  topicTags(),
  mentionTags(),
  embeds(),
  emoji(), // zero config: the built-in gemoji-standard map
  footnote(),
  file(),
  detailsToggle(),
];

// The composer demo keeps to statically-renderable plugins (no live widgets)
// so posted messages render read-only through the SAME codec the editor uses.
const COMPOSER_PLUGINS = [highlight(), callout(), topicTags(), mentionTags(), emoji()];

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

const SEED_POSTS = [
  "hey @vivek — **v0.9.0** is out :rocket: the ==composer mode== you're typing in right now ships in it :tada:",
  "Everything here is stored as plain Markdown — expand *Stored Markdown* under any message to see the exact bytes. :eyes:",
];

/** A Slack-style compose box + feed: `layout:"fill"`, a fixed toolbar, emoji
 *  and mention typeahead — and every posted message rendered read-only with
 *  the SAME plugin codec, so what you typed is exactly what renders. */
function ComposerDemo() {
  const [posts, setPosts] = useState<string[]>(SEED_POSTS);
  const [draftEmpty, setDraftEmpty] = useState(true);
  const editorRef = useRef<EdodoWrite | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [posts]);

  const post = () => {
    const editor = editorRef.current;
    if (!editor || editor.isEmpty()) return;
    // Read EAGERLY: a `setPosts(p => [...p, editor.getMarkdown()])` updater
    // runs lazily at re-render — after the setMarkdown("") below has already
    // cleared the editor.
    const md = editor.getMarkdown();
    setPosts((p) => [...p, md]);
    editor.setMarkdown("");
    setDraftEmpty(true);
    editor.focus();
  };

  return (
    <main className="site__main site__main--composer">
      <section className="site__pane composer">
        <div className="site__pane-head">
          #general — a chat composer built on <code>layout: "fill"</code> + <code>toolbar: "fixed"</code>
        </div>
        <div className="composer__feed" ref={feedRef}>
          {posts.map((md, i) => (
            <article className="composer__post" key={i}>
              <div className="composer__avatar" aria-hidden>{i % 2 ? "🤖" : "🦤"}</div>
              <div className="composer__bubble">
                <Markdown value={md} plugins={COMPOSER_PLUGINS} />
                <details className="composer__source">
                  <summary>Stored Markdown</summary>
                  <pre>{md}</pre>
                </details>
              </div>
            </article>
          ))}
        </div>
        <div className="composer__box">
          <EdodoWriteEditor
            placeholder="Share your thoughts… (try :emoji, @mentions, #topics, / commands)"
            layout="fill"
            toolbar={{
              mode: "fixed",
              items: ["bold", "italic", "strike", "link", "bulletList", "orderedList", "code", "codeBlock", "blockquote"],
            }}
            plugins={COMPOSER_PLUGINS}
            autofocus
            ariaLabel="Message composer"
            onReady={(editor) => { editorRef.current = editor; }}
            onChange={() => setDraftEmpty(editorRef.current?.isEmpty() ?? true)}
          />
          <div className="composer__actions">
            <span className="composer__hint">
              <code>:rock</code> → 🚀 &nbsp;·&nbsp; <code>@viv</code> → mention &nbsp;·&nbsp; the bar reflects the caret
            </span>
            <button className="composer__send" onClick={post} disabled={draftEmpty} title="Post message">
              Post ➤
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

export function Site() {
  const [view, setView] = useState<"page" | "composer">("page");
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
        <div className="site__views" role="tablist" aria-label="Demo mode">
          <button
            role="tab"
            aria-selected={view === "page"}
            className={view === "page" ? "is-active" : ""}
            onClick={() => setView("page")}
          >
            📄 Page editor
          </button>
          <button
            role="tab"
            aria-selected={view === "composer"}
            className={view === "composer" ? "is-active" : ""}
            onClick={() => setView("composer")}
          >
            💬 Composer
          </button>
        </div>
        {view === "page" && (
          <>
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
          </>
        )}
      </div>

      {view === "composer" ? (
        <ComposerDemo />
      ) : (
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
            <pre className="site__markdown">{markdown || " "}</pre>
          </section>
        </main>
      )}

      <footer className="site__footer">
        <code>npm i edodo-write</code>
        <span>·</span>
        <span>MIT</span>
        <span>·</span>
        <a href="https://vivmagarwal.github.io/edodo-write/" target="_blank" rel="noreferrer">docs & demo</a>
        <span>·</span>
        <a href="llms-full.txt" target="_blank" rel="noreferrer" title="Complete docs in one file, for LLMs">llms.txt</a>
      </footer>
    </div>
  );
}
