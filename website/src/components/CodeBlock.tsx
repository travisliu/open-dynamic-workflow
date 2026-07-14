import { useState, type ReactNode } from "react";

interface CodeBlockProps {
  lang?: string;
  children: string;
}

export default function CodeBlock({ lang = "typescript", children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(children.trim()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{lang}</span>
        <button className="copy-btn" onClick={handleCopy} aria-label="Copy code">
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <SimpleHighlight lang={lang} code={children.trim()} />
      </pre>
    </div>
  );
}

// Simple syntax highlighter without external library dependency
function SimpleHighlight({ lang, code }: { lang: string; code: string }) {
  if (lang === "bash" || lang === "sh") {
    // Highlight bash: comments and flags
    const parts = code.split(/(\#[^\n]*|--[\w-]+=?\S*)/g);
    return (
      <>
        {parts.map((part, i) => {
          if (part.startsWith("#")) {
            return <span key={i} style={{ color: "var(--syn-comment)" }}>{part}</span>;
          }
          if (part.startsWith("--")) {
            return <span key={i} style={{ color: "var(--syn-operator)" }}>{part}</span>;
          }
          return <span key={i} style={{ color: "#c3e88d" }}>{part}</span>;
        })}
      </>
    );
  }

  if (lang === "yaml") {
    const lines = code.split("\n");
    return (
      <>
        {lines.map((line, i) => {
          const trimmed = line.trimStart();
          if (trimmed.startsWith("#")) {
            return <span key={i} style={{ color: "var(--syn-comment)" }}>{line + "\n"}</span>;
          }
          // key: value
          const colonIdx = line.indexOf(":");
          if (colonIdx > 0 && !trimmed.startsWith("-")) {
            const key = line.slice(0, colonIdx + 1);
            const value = line.slice(colonIdx + 1);
            return (
              <span key={i}>
                <span style={{ color: "var(--syn-func)" }}>{key}</span>
                <span style={{ color: "#cdd6f4" }}>{value}</span>
                {"\n"}
              </span>
            );
          }
          return <span key={i} style={{ color: "#cdd6f4" }}>{line + "\n"}</span>;
        })}
      </>
    );
  }

  // TypeScript/JavaScript: simple keyword highlighting
  const tsKeywords = /\b(import|export|from|const|let|var|async|await|function|return|default|if|else|for|of|in|true|false|null|undefined|new|type|interface|extends|implements|class|this|typeof|keyof|readonly|as)\b/g;
  const tsStrings = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  const tsComments = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
  const tsNumbers = /\b(\d+(?:\.\d+)?)\b/g;

  // Collect all tokens in order
  type Token = { start: number; end: number; type: string; text: string };
  const tokens: Token[] = [];

  function addMatches(regex: RegExp, type: string) {
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(code)) !== null) {
      tokens.push({ start: m.index, end: m.index + m[0].length, type, text: m[0] });
    }
  }

  addMatches(tsComments, "comment");
  addMatches(tsStrings, "string");
  addMatches(tsKeywords, "keyword");
  addMatches(tsNumbers, "number");

  // Sort by start, deduplicate overlapping
  tokens.sort((a, b) => a.start - b.start);
  const filtered: Token[] = [];
  let lastEnd = 0;
  for (const tok of tokens) {
    if (tok.start >= lastEnd) {
      filtered.push(tok);
      lastEnd = tok.end;
    }
  }

  const colorMap: Record<string, string> = {
    keyword: "var(--syn-keyword)",
    string: "var(--syn-string)",
    comment: "var(--syn-comment)",
    number: "var(--syn-number)",
  };

  const result: ReactNode[] = [];
  let cursor = 0;
  for (const tok of filtered) {
    if (tok.start > cursor) {
      result.push(<span key={cursor}>{code.slice(cursor, tok.start)}</span>);
    }
    result.push(
      <span key={tok.start} style={{ color: colorMap[tok.type] }}>
        {tok.text}
      </span>
    );
    cursor = tok.end;
  }
  if (cursor < code.length) {
    result.push(<span key={cursor}>{code.slice(cursor)}</span>);
  }
  return <>{result}</>;
}

interface BashBlockProps {
  children: string;
}

export function BashBlock({ children }: BashBlockProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(children.trim()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="bash-block" style={{ position: "relative" }}>
      <span className="bash-prompt">$</span>
      <code>{children.trim()}</code>
      <button
        className="copy-btn"
        onClick={handleCopy}
        aria-label="Copy command"
        style={{ marginLeft: "auto", color: "rgba(255,255,255,0.35)" }}
      >
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}
