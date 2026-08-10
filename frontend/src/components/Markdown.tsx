import React, { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";

function splitBlocks(text) {
  const blocks = [];
  const lines = String(text || "").split("\n");
  let para = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "text", content: para });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^\s*```(\w*)\s*$/);
    if (fence) {
      flushPara();
      const lang = fence[1] || "sql";
      const content = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        content.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", lang, content: content.join("\n") });
      continue;
    }
    para.push(lines[i]);
  }
  flushPara();
  return blocks;
}

function renderInline(text) {
  const nodes = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let match;
  let key = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1]) {
      nodes.push(<code key={key++}>{match[1].slice(1, -1)}</code>);
    } else if (match[2]) {
      nodes.push(<strong key={key++}>{match[2].slice(2, -2)}</strong>);
    } else if (match[3]) {
      nodes.push(<em key={key++}>{match[3].slice(1, -1)}</em>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function TextBlock({ lines }) {
  const paragraphs = [];
  let list = [];
  let para = [];

  const flushList = () => {
    if (list.length) {
      paragraphs.push({ type: "list", ordered: list.ordered, items: list.items });
      list = [];
    }
  };
  const flushPara = () => {
    if (para.length) {
      paragraphs.push({ type: "para", lines: para });
      para = [];
    }
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      paragraphs.push({ type: "heading", level: heading[1].length, content: heading[2] });
      continue;
    }
    if (bullet || numbered) {
      flushPara();
      const item = bullet ? bullet[1] : numbered[1];
      if (!list.items) list = { ordered: !!numbered, items: [] };
      list.items.push(item);
      continue;
    }
    flushList();
    if (line.trim() === "") {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushList();
  flushPara();

  return paragraphs.map((block, index) => {
    switch (block.type) {
      case "heading":
        const Tag = `h${block.level}`;
        return <Tag key={index}>{renderInline(block.content)}</Tag>;
      case "para":
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line)}
              </span>
            ))}
          </p>
        );
      case "list": {
        const ListTag = block.ordered ? "ol" : "ul";
        return (
          <ListTag key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </ListTag>
        );
      }
      default:
        return null;
    }
  });
}

function CodeBlock({ lang, content, onInsert }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="aiCodeBlock">
      <div className="aiCodeHead">
        <span>{lang || "sql"}</span>
        <div>
          {onInsert && (
            <button onClick={() => onInsert(content)} title="Send to editor">
              Use in editor
            </button>
          )}
          <button onClick={copy}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  );
}

export function Markdown({ text, onInsert }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  return (
    <div className="markdown">
      {blocks.map((block, index) =>
        block.type === "code" ? (
          <CodeBlock key={index} lang={block.lang} content={block.content} onInsert={onInsert} />
        ) : (
          <TextBlock key={index} lines={block.content} />
        ),
      )}
    </div>
  );
}
