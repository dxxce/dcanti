// Lightweight, dependency-free markdown renderer for chat messages.
// Handles the common subset the AI actually produces: fenced code blocks,
// inline code, bold/italic, headings, links, unordered/ordered lists,
// blockquote alerts ([!NOTE]/[!IMPORTANT]/…), and paragraphs. File links
// (file:///…) are clickable and open in the Files tab. Everything is escaped
// first so it is safe to render.

import { useState } from "react";
import { Icon } from "./Icon";
import hljs from "highlight.js/lib/common";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
const FILE_ICON_SVG = `<svg class="icon file-link-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

// Inline formatting: code, bold, italic, links (http + file). Operates on
// already-escaped text. File links become data-file spans the click handler
// intercepts to open them in the Files tab.
function renderInline(text: string): string {
  let out = text;
  // inline code first (protect its contents from further formatting with unique placeholder)
  const codeSpans: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, c) => {
    codeSpans.push(c);
    return `\u0000CODESPAN_${codeSpans.length - 1}\u0000`;
  });
  // file links [text](file:///path) — clickable, opens in Files
  out = out.replace(
    /\[([^\]]+)\]\((file:\/\/[^\s)]+)\)/g,
    (_m, label, uri) => {
      const path = decodeURIComponent(String(uri).replace(/^file:\/\//, ""));
      return `<a class="file-link" data-file="${escapeHtml(path)}" title="${escapeHtml(path)}">${FILE_ICON_SVG}<span>${label}</span></a>`;
    }
  );
  // http links [text](url)
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // italic
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  // restore code spans
  out = out.replace(/\u0000CODESPAN_(\d+)\u0000/g, (_m, i) => `<code>${codeSpans[+i]}</code>`);
  return out;
}

interface Block {
  type: "code" | "html";
  lang?: string;
  content: string;
}

// Split into fenced code blocks vs. everything else (rendered as html).
function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.split("\n");
  let i = 0;
  let buffer: string[] = [];

  const flushHtml = () => {
    if (buffer.length === 0) return;
    blocks.push({ type: "html", content: renderHtmlBlock(buffer.join("\n")) });
    buffer = [];
  };

  while (i < lines.length) {
    const fence = lines[i].match(/^\s*```(.*)$/);
    if (fence) {
      flushHtml();
      const lang = fence[1].trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: "code", lang, content: code.join("\n") });
    } else {
      buffer.push(lines[i]);
      i++;
    }
  }
  flushHtml();
  return blocks;
}

// GitHub-style alert kinds ([!NOTE], [!IMPORTANT], …) → css class + label + SVG icon.
const ALERT_KINDS: Record<string, { cls: string; label: string; svg: string }> = {
  NOTE: {
    cls: "note",
    label: "Note",
    svg: `<svg class="icon alert-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  },
  TIP: {
    cls: "tip",
    label: "Tip",
    svg: `<svg class="icon alert-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>`,
  },
  IMPORTANT: {
    cls: "important",
    label: "Important",
    svg: `<svg class="icon alert-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  },
  WARNING: {
    cls: "warning",
    label: "Warning",
    svg: `<svg class="icon alert-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  },
  CAUTION: {
    cls: "caution",
    label: "Caution",
    svg: `<svg class="icon alert-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  },
};

// Render a non-code block (headings, lists, blockquotes, paragraphs) to html.
function renderHtmlBlock(src: string): string {
  const lines = src.split("\n");
  const html: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let para: string[] = [];
  let quote: string[] = [];

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${renderInline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushQuote = () => {
    if (!quote.length) return;
    // First line may be an alert marker like "[!IMPORTANT]".
    let kind = ALERT_KINDS.NOTE;
    let isAlert = false;
    const m = quote[0].match(/^\[!(\w+)\]\s*$/);
    let body = quote;
    if (m && ALERT_KINDS[m[1].toUpperCase()]) {
      kind = ALERT_KINDS[m[1].toUpperCase()];
      isAlert = true;
      body = quote.slice(1);
    }
    const inner = body.map((l) => renderInline(escapeHtml(l))).join("<br/>");
    if (isAlert) {
      html.push(
        `<div class="md-alert ${kind.cls}"><div class="md-alert-title">${kind.svg} <span>${kind.label}</span></div><div class="md-alert-body">${inner}</div></div>`
      );
    } else {
      html.push(`<blockquote>${inner}</blockquote>`);
    }
    quote = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushPara();
      closeList();
      quote.push(bq[1]);
      continue;
    }
    flushQuote();
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? "ul" : "ol";
      if (listType !== want) {
        closeList();
        listType = want;
        html.push(`<${want}>`);
      }
      html.push(`<li>${renderInline(escapeHtml((ul ?? ol)![1]))}</li>`);
      continue;
    }
    // plain paragraph line
    if (listType) closeList();
    para.push(escapeHtml(line));
  }
  flushQuote();
  flushPara();
  closeList();
  return html.join("\n");
}

function CodeBlock({ lang, content }: { lang?: string; content: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  // Syntax highlight (best-effort). Fall back to escaped plain text.
  let html = "";
  try {
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(content, { language: lang }).value;
    } else {
      html = hljs.highlightAuto(content).value;
    }
  } catch {
    html = escapeHtml(content);
  }
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{lang || "code"}</span>
        <button className="code-copy" onClick={copy} title="Copy">
          <Icon name={copied ? "check" : "file"} size={13} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre>
        <code
          className="hljs"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </div>
  );
}

export function Markdown({
  text,
  onOpenFile,
}: {
  text: string;
  onOpenFile?: (path: string) => void;
}) {
  const blocks = parseBlocks(text);
  // Intercept clicks on file links so they open in the Files tab.
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("a.file-link");
    if (target) {
      e.preventDefault();
      const p = target.getAttribute("data-file");
      if (p && onOpenFile) onOpenFile(p);
    }
  };
  return (
    <div className="markdown" onClick={onClick}>
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <CodeBlock key={i} lang={b.lang} content={b.content} />
        ) : (
          <div key={i} dangerouslySetInnerHTML={{ __html: b.content }} />
        )
      )}
    </div>
  );
}
