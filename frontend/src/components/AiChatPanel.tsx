import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Eraser,
  Loader2,
  Send,
  Settings2,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { aiProviderRequiresKey, api, streamChatAI } from "../utils/api";
import { AiSettingsForm } from "./AiSettings";
import { Markdown } from "./Markdown";

const STORAGE_KEY = "tnt-sql-ai-chat-v1";

function newId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function emptySettings() {
  return { provider: "openai", baseUrl: "", apiKey: "", model: "" };
}

function schemaContext(detail) {
  if (!detail) return "";
  const lines = [];
  lines.push(`Connection driver: ${detail.driver || ""} | Database: ${detail.database || ""}`);
  const tables = detail.tables || [];
  for (const table of tables) {
    const columns = (table.columns || [])
      .map((column) => `${column.name} ${column.type}`)
      .join(", ");
    const name = table.schema ? `${table.schema}.${table.name}` : table.name;
    lines.push(`TABLE ${name} (${columns})`);
  }
  const routines = detail.routines || [];
  for (const routine of routines) {
    const name = routine.schema ? `${routine.schema}.${routine.name}` : routine.name;
    lines.push(`${(routine.type || "ROUTINE").toUpperCase()} ${name}`);
  }
  return lines.join("\n");
}

function buildMessages(history, detail) {
  const system = {
    role: "system",
    content:
      "You are dbVibe AI, an expert SQL and database assistant built into the dbVibe desktop app. " +
      "Help write, explain, debug, and optimize SQL and database commands. " +
      "Be concise and practical. Put SQL and command examples in fenced code blocks. " +
      "If the user pastes a query or describes an error, respond to it directly.\n\n" +
      "Current database schema:\n" +
      (schemaContext(detail) || "(no connection selected)"),
  };
  const messages = history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => (message.content || "").trim() !== "")
    .map(({ role, content }) => ({ role, content }));
  return [system, ...messages];
}

export const AiChatPanel = forwardRef(function AiChatPanel(
  { detail, onClose, onInsertQuery, onToast, visible },
  ref,
) {
  const [settings, setSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [testOk, setTestOk] = useState(false);
  const scrollRef = useRef(null);
  const streamingRef = useRef(false);

  useEffect(() => {
    api
      .call("LoadAISettings")
      .then((loaded) => {
        const next = loaded && (loaded.provider || loaded.model || loaded.baseUrl || loaded.apiKey) ? loaded : emptySettings();
        setSettings(next);
        if (!next.model) setShowSettings(true);
      })
      .catch(() => {
        setSettings(emptySettings());
        setShowSettings(true);
      });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-200)));
    } catch {
      /* storage unavailable */
    }
  }, [messages]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streaming, showSettings]);

  const configured =
    settings &&
    settings.model &&
    (!aiProviderRequiresKey(settings.provider) || settings.apiKey);

  function appendAssistant(delta, stillStreaming) {
    setMessages((current) => {
      const next = current.slice();
      const last = next[next.length - 1];
      if (!last || last.role !== "assistant") return current;
      next[next.length - 1] = {
        ...last,
        content: last.content + delta,
        streaming: stillStreaming,
      };
      return next;
    });
  }

  async function send(text) {
    const prompt = String(text || "").trim();
    if (!prompt) return;
    if (streamingRef.current) return;
    if (!configured) {
      setShowSettings(true);
      return;
    }
    const userMessage = { id: newId(), role: "user", content: prompt };
    const assistantMessage = { id: newId(), role: "assistant", content: "", streaming: true };
    const history = [...messages, userMessage, assistantMessage];
    setMessages(history);
    setInput("");
    setStreaming(true);
    streamingRef.current = true;
    try {
      await streamChatAI(buildMessages(history, detail), {
        onChunk: (delta) => appendAssistant(delta, true),
        onDone: () => appendAssistant("", false),
        onError: (err) => {
          appendAssistant(`Request failed: ${err?.message || String(err)}`, false);
          onToast?.(err?.message || "AI request failed");
        },
      });
    } finally {
      setStreaming(false);
      streamingRef.current = false;
    }
  }

  function stop() {
    api.call("CancelAIStream").catch(() => {});
  }

  async function saveSettings() {
    try {
      const saved = await api.call("SaveAISettings", settings);
      setSettings(saved || settings);
      setShowSettings(false);
      setTestOk(false);
      onToast?.(`AI provider configured (${saved?.model || settings?.model})`);
    } catch (err) {
      onToast?.(err?.message || "Failed to save AI settings");
    }
  }

  function copyText(text) {
    navigator.clipboard?.writeText?.(text);
    onToast?.("Copied to clipboard");
  }

  useImperativeHandle(
    ref,
    () => ({
      ask(text) {
        setShowSettings(false);
        send(text);
      },
    }),
    [configured, detail, messages],
  );

  return (
    <aside
      className={`aiPanel ${showSettings ? "aiPanelSettingsView" : ""} ${visible ? "" : "hidden"}`}
    >
      <div className="panelHead aiPanelHead">
        <h2 className="aiPanelTitle">
          <Bot size={18} /> AI Chat
        </h2>
        <div className="rowActions">
          {streaming && (
            <button onClick={stop} title="Stop generating">
              <Square size={16} />
            </button>
          )}
          <button
            onClick={() => setMessages([])}
            title="New chat"
            disabled={streaming}
          >
            <Eraser size={16} />
          </button>
          <button
            className={showSettings ? "active" : ""}
            onClick={() => setShowSettings(!showSettings)}
            title="AI provider settings"
          >
            <Settings2 size={16} />
          </button>
          <button onClick={onClose} title="Close AI panel">
            <X size={16} />
          </button>
        </div>
      </div>

      {showSettings ? (
        <div className="aiPanelBody aiPanelSettingsBody">
          <p className="aiPanelHint">
            Connect any AI provider with an API key — OpenAI, Anthropic, Google
            Gemini, DeepSeek, OpenRouter, Groq, Mistral, xAI, or a local Ollama /
            OpenAI-compatible server.
          </p>
          <AiSettingsForm
            settings={settings || emptySettings()}
            onChange={(next) => {
              setSettings(next);
              setTestOk(false);
            }}
            onToast={onToast}
            onTested={setTestOk}
          />
          <div className="aiSettingsSaveRow">
            <button
              className="primary"
              onClick={saveSettings}
              disabled={!settings?.model || !testOk}
              title={
                settings?.model && testOk
                  ? "Save provider and start chatting"
                  : "Run \"Test connection\" successfully first, then save"
              }
            >
              <Check size={16} /> Save &amp; Start Chat
            </button>
          </div>
        </div>
      ) : settings === null ? (
        <div className="aiPanelBody aiChatLoading">
          <Loader2 size={20} className="spin" />
        </div>
      ) : (
        <>
          <div className="aiChatMessages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="aiChatEmpty">
                <Sparkles size={22} />
                <p>Ask about a query, schema, or error.</p>
                <p className="aiChatEmptyHint">
                  Select SQL in the editor and press <kbd>Cmd</kbd>+<kbd>L</kbd>, or
                  type a question below.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`aiMsg ${message.role}`}>
                <div className="aiMsgRole">
                  {message.role === "user" ? "You" : "AI"}
                </div>
                <div className="aiMsgBody">
                  {message.content ? (
                    <Markdown text={message.content} onInsert={onInsertQuery} />
                  ) : message.streaming ? (
                    <span className="aiTyping">
                      <Loader2 size={13} className="spin" />
                    </span>
                  ) : null}
                </div>
                {message.role === "assistant" && message.content && (
                  <div className="aiMsgActions">
                    <button onClick={() => copyText(message.content)}>
                      <Copy size={12} /> Copy
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="aiChatComposer">
            {!configured && !streaming && (
              <div className="aiChatConfigHint">
                <button onClick={() => setShowSettings(true)}>
                  <Settings2 size={13} /> Configure AI provider to start chatting
                </button>
              </div>
            )}
            <textarea
              value={input}
              placeholder="Ask about a query, schema, or error..."
              rows={3}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            <div className="aiChatComposerRow">
              <span className="aiChatComposerHint">
                Enter to send · Shift+Enter for newline
              </span>
              <button
                className="primary"
                onClick={() => send(input)}
                disabled={!input.trim() || streaming}
              >
                {streaming ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
});
