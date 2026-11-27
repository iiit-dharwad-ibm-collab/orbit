import fs from "fs";
import path from "path";
import Sidebar from "@/components/Sidebar";
import styles from "./blog.module.css";

export const dynamic = "force-dynamic";

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Turns blog.txt's light plain-text conventions into typed blocks:
//   "# Heading"            -> section
//   "1. Title."            -> numbered design-choice card (following paragraph is its body)
//   indented "name   desc" -> tool card (continuation lines extend desc)
//   indented "- item"      -> bullet list
//   indented quoted text   -> highlighted prompt
//   other indented lines   -> terminal block
function parseBlog(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const title = lines[0].trim();
  const sections = [];
  let current = { title: null, blocks: [] };
  let para = [];
  let indented = [];
  let choice = null;

  const pushBlock = (b) => current.blocks.push(b);
  const flushPara = () => {
    if (!para.length) return;
    const textOut = para.join(" ");
    if (choice) {
      choice.body = choice.body ? `${choice.body} ${textOut}` : textOut;
    } else {
      pushBlock({ type: "p", text: textOut });
    }
    para = [];
  };
  const flushIndented = () => {
    if (!indented.length) return;
    const raw = indented.join("\n").replace(/\n+$/, "");
    const rows = raw.split("\n").filter((l) => l.trim());
    if (rows.every((l) => l.trim().startsWith("- "))) {
      pushBlock({ type: "list", items: rows.map((l) => l.trim().slice(2)) });
    } else if (/^\S+\s{3,}\S/.test(rows[0]) && rows.every((l) => /^\S+\s{3,}\S/.test(l) || /^\s{6,}\S/.test(l))) {
      const tools = [];
      for (const l of rows) {
        const m = l.match(/^(\S+)\s{3,}(.*)$/);
        if (m) tools.push({ name: m[1], desc: m[2].trim() });
        else tools[tools.length - 1].desc += ` ${l.trim()}`;
      }
      pushBlock({ type: "tools", tools });
    } else if (rows[0].trim().startsWith('"')) {
      pushBlock({ type: "prompt", text: rows.map((l) => l.trim()).join(" ").replace(/^"|"$/g, "") });
    } else if (rows.every((l) => /^\S+:\s/.test(l.trim()))) {
      pushBlock({ type: "creds", items: rows.map((l) => l.trim()) });
    } else {
      const label = rows[0].match(/^\d+\.\s+(.*)$/);
      if (label && rows.length > 1) {
        pushBlock({ type: "p", text: label[1] });
        const body = rows.slice(1);
        const pad = Math.min(...body.map((l) => l.match(/^\s*/)[0].length));
        if (body[0].trim().startsWith('"')) {
          pushBlock({ type: "prompt", text: body.map((l) => l.trim()).join(" ").replace(/^"|"$/g, "") });
        } else {
          pushBlock({ type: "code", text: body.map((l) => l.slice(pad)).join("\n") });
        }
      } else {
        pushBlock({ type: "code", text: raw });
      }
    }
    indented = [];
  };
  const splitSteps = () => {
    // Numbered terminal steps ("1. Log in...", "2. ...") each become their own block.
    const groups = [];
    for (const l of indented) {
      if (/^\d+\.\s/.test(l)) groups.push([l]);
      else if (groups.length) groups[groups.length - 1].push(l);
      else groups.push([l]);
    }
    if (groups.length > 1 && /^\d+\.\s/.test(groups[0][0])) {
      for (const g of groups) { indented = g; flushIndented(); }
      indented = [];
    } else {
      flushIndented();
    }
  };
  const closeChoice = () => {
    flushPara();
    if (choice) pushBlock(choice);
    choice = null;
  };

  for (const line of lines.slice(1)) {
    if (/^=+$/.test(line.trim())) continue;
    if (line.startsWith("# ")) {
      closeChoice(); splitSteps();
      if (current.title || current.blocks.length) sections.push(current);
      current = { title: line.slice(2).trim(), blocks: [] };
      continue;
    }
    const choiceMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (choiceMatch && !line.startsWith(" ")) {
      closeChoice(); splitSteps();
      choice = { type: "choice", idx: choiceMatch[1], title: choiceMatch[2].replace(/\.$/, ""), body: "" };
      continue;
    }
    if (choice && line.trim()) {
      para.push(line.trim());
      continue;
    }
    if (line.startsWith("  ") && line.trim()) {
      flushPara();
      indented.push(line.slice(2));
      continue;
    }
    if (!line.trim()) {
      flushPara();
      if (indented.length) indented.push("");
      continue;
    }
    splitSteps();
    para.push(line.trim());
  }
  closeChoice(); splitSteps();
  sections.push(current);

  return { title, sections: sections.filter((s) => s.title) };
}

function Block({ block }) {
  switch (block.type) {
    case "tools":
      return (
        <div className={styles.toolGrid}>
          {block.tools.map((t) => (
            <div key={t.name} className={styles.tool}>
              <span className={styles.toolName}>{t.name}</span>
              <div className={styles.toolDesc}>{t.desc}</div>
            </div>
          ))}
        </div>
      );
    case "choice":
      return (
        <div className={styles.choice}>
          <div className={styles.choiceTitle}>
            <span className={styles.choiceIdx}>0{block.idx}</span>
            {block.title}
          </div>
          <div className={styles.choiceBody}>{block.body}</div>
        </div>
      );
    case "code":
      return (
        <div className={styles.terminal}>
          <div className={styles.terminalBar}>
            <span className={styles.dot} style={{ background: "#F87171" }} />
            <span className={styles.dot} style={{ background: "#FBBF24" }} />
            <span className={styles.dot} style={{ background: "#34D399" }} />
            <span className={styles.terminalLabel}>terminal</span>
          </div>
          <pre>{block.text}</pre>
        </div>
      );
    case "prompt":
      return <blockquote className={styles.prompt}>“{block.text}”</blockquote>;
    case "creds":
      return (
        <div className={styles.creds}>
          {block.items.map((c) => <span key={c} className={styles.cred}>{c}</span>)}
        </div>
      );
    case "list":
      return (
        <ul className={styles.bullets}>
          {block.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      );
    default:
      return <p className={styles.p}>{block.text}</p>;
  }
}

export default function BlogPage() {
  const text = fs.readFileSync(path.join(process.cwd(), "blog.txt"), "utf8");
  const { title, sections } = parseBlog(text);
  const words = text.split(/\s+/).length;
  const lede = sections[0]?.blocks.find((b) => b.type === "p")?.text;

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        <header className={styles.hero}>
          <span className={styles.eyebrow}>⚡ Engineering Blog</span>
          <h1 className={styles.heroTitle}>{title}</h1>
          {lede && <p className={styles.heroLede}>{lede}</p>}
          <div className={styles.meta}>
            <span className={styles.metaChip}>MCP</span>
            <span className={styles.metaChip}>Batch workflows</span>
            <span className={styles.metaChip}>Next.js</span>
            <span className={styles.metaChip}>{Math.max(1, Math.round(words / 220))} min read</span>
          </div>
        </header>

        <div className={styles.layout}>
          <article className={styles.article}>
            {sections.map((section, si) => (
              <section key={section.title} id={slugify(section.title)} className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionNum}>{si + 1}</span>
                  <h2 className={styles.sectionTitle}>{section.title}</h2>
                </div>
                {section.blocks
                  .filter((b) => !(si === 0 && b.type === "p" && b.text === lede))
                  .map((b, i) => <Block key={i} block={b} />)}
              </section>
            ))}
            <footer className={styles.footer}>Dataset Annotator · Built with the Model Context Protocol</footer>
          </article>

          <nav className={styles.toc}>
            <div className={styles.tocTitle}>On this page</div>
            {sections.map((s) => (
              <a key={s.title} href={`#${slugify(s.title)}`} className={styles.tocLink}>{s.title}</a>
            ))}
          </nav>
        </div>
      </main>
    </div>
  );
}
