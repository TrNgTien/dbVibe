import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  History,
  Loader2,
  PlugZap,
  Plus,
  Search,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  aiProviderDefaults,
  aiProviderLabel,
  aiProviderRequiresKey,
  api,
  streamChatAI,
} from "../utils/api";
import { AiSettingsForm } from "./AiSettings";
import { Markdown } from "./Markdown";

const SESSIONS_KEY = "tnt-sql-ai-sessions-v1";
const ACTIVE_SESSION_KEY = "tnt-sql-ai-active-session-v1";
const LEGACY_STORAGE_KEY = "tnt-sql-ai-chat-v1"; // pre-multi-session single chat log

function newId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function deriveTitle(messages) {
  const firstUser = messages.find((m) => m.role === "user" && (m.content || "").trim());
  if (!firstUser) return "New chat";
  const text = firstUser.content.trim().replace(/\s+/g, " ");
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

function freshSession() {
  return { id: newId(), title: "New chat", messages: [], updatedAt: Date.now() };
}

function loadInitialState() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.id) {
      const savedActive = localStorage.getItem(ACTIVE_SESSION_KEY);
      const activeId = parsed.some((s) => s.id === savedActive) ? savedActive : parsed[0].id;
      return { sessions: parsed, activeId };
    }
  } catch {
    /* ignore */
  }
  try {
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
    if (Array.isArray(legacy) && legacy.length > 0) {
      const session = { id: newId(), title: deriveTitle(legacy), messages: legacy, updatedAt: Date.now() };
      return { sessions: [session], activeId: session.id };
    }
  } catch {
    /* ignore */
  }
  const session = freshSession();
  return { sessions: [session], activeId: session.id };
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
  const [showHistory, setShowHistory] = useState(false);
  const initRef = useRef(null);
  if (initRef.current === null) initRef.current = loadInitialState();
  const [sessions, setSessions] = useState(() => initRef.current.sessions);
  const [activeId, setActiveId] = useState(() => initRef.current.activeId);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [testOk, setTestOk] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [draft, setDraft] = useState(null);
  const [modelOptions, setModelOptions] = useState([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const scrollRef = useRef(null);
  const streamingRef = useRef(false);
  const modelCacheRef = useRef({ signature: "", options: [] });
  const modelPickerRef = useRef(null);

  const activeSession = sessions.find((s) => s.id === activeId) || sessions[0];
  const messages = activeSession ? activeSession.messages : [];

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
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50)));
    } catch {
      /* storage unavailable */
    }
  }, [sessions]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_SESSION_KEY, activeId || "");
    } catch {
      /* storage unavailable */
    }
  }, [activeId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streaming, showSettings]);

  useEffect(() => {
    if (!showModelPicker) return;
    function onPointerDown(e) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target)) {
        setShowModelPicker(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showModelPicker]);

  const configured =
    settings &&
    settings.model &&
    (!aiProviderRequiresKey(settings.provider) || settings.apiKey);

  function appendAssistant(sessionId, delta, stillStreaming) {
    setSessions((current) =>
      current.map((s) => {
        if (s.id !== sessionId) return s;
        const msgs = s.messages.slice();
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== "assistant") return s;
        msgs[msgs.length - 1] = { ...last, content: last.content + delta, streaming: stillStreaming };
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }),
    );
  }

  async function send(text) {
    const prompt = String(text || "").trim();
    if (!prompt) return;
    if (streamingRef.current) return;
    if (!configured) {
      setShowSettings(true);
      return;
    }
    const sessionId = activeSession.id;
    const userMessage = { id: newId(), role: "user", content: prompt };
    const assistantMessage = { id: newId(), role: "assistant", content: "", streaming: true };
    const history = [...messages, userMessage, assistantMessage];
    setSessions((current) =>
      current.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages: history,
              title: s.title === "New chat" ? deriveTitle(history) : s.title,
              updatedAt: Date.now(),
              model: settings?.model || s.model,
            }
          : s,
      ),
    );
    setInput("");
    setStreaming(true);
    streamingRef.current = true;
    try {
      await streamChatAI(buildMessages(history, detail), {
        onChunk: (delta) => appendAssistant(sessionId, delta, true),
        onDone: () => appendAssistant(sessionId, "", false),
        onError: (err) => {
          appendAssistant(sessionId, `Request failed: ${err?.message || String(err)}`, false);
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

  function newChat() {
    const session = freshSession();
    setSessions((current) => [session, ...current]);
    setActiveId(session.id);
    setShowHistory(false);
  }

  function openSession(id) {
    setActiveId(id);
    setShowHistory(false);
  }

  function deleteSession(id) {
    setSessions((current) => {
      const next = current.filter((s) => s.id !== id);
      if (next.length === 0) {
        const session = freshSession();
        if (id === activeId) setActiveId(session.id);
        return [session];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
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

  async function fetchModelOptions(cfg, force) {
    if (!cfg) return;
    const signature = `${cfg.provider}|${cfg.baseUrl}|${cfg.apiKey}`;
    if (!force && modelCacheRef.current.signature === signature) {
      setModelOptions(modelCacheRef.current.options);
      return;
    }
    setModelLoading(true);
    setModelError("");
    try {
      const list = await api.call("TestAIModels", cfg);
      modelCacheRef.current = { signature, options: list || [] };
      setModelOptions(list || []);
    } catch (err) {
      setModelError(err?.message || "Failed to load models");
      setModelOptions([]);
    } finally {
      setModelLoading(false);
    }
  }

  function openModelPicker() {
    const base = settings || emptySettings();
    setDraft({ ...base });
    setModelSearch("");
    setModelOptions([]);
    setModelError("");
    setShowModelPicker(true);
    if (!aiProviderRequiresKey(base.provider) || base.apiKey) {
      fetchModelOptions(base, false);
    }
  }

  function changeDraftProvider(provider) {
    const defaults = aiProviderDefaults[provider] || {};
    const next = {
      ...draft,
      provider,
      baseUrl: defaults.baseUrl || "",
      apiKey: provider === settings?.provider ? settings?.apiKey || "" : "",
      model: defaults.model || "",
    };
    setDraft(next);
    setModelOptions([]);
    setModelError("");
    if (!aiProviderRequiresKey(provider) || next.apiKey) {
      fetchModelOptions(next, false);
    }
  }

  function connectDraft() {
    fetchModelOptions(draft, true);
  }

  async function confirmModel(model) {
    if (!draft) return;
    const next = { ...draft, model };
    setShowModelPicker(false);
    try {
      const saved = await api.call("SaveAISettings", next);
      setSettings(saved || next);
      setTestOk(true);
      onToast?.(`Switched to ${aiProviderLabel(next.provider)} · ${model}`);
    } catch (err) {
      onToast?.(err?.message || "Failed to switch model");
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      ask(text) {
        setShowSettings(false);
        setShowHistory(false);
        send(text);
      },
    }),
    [configured, detail, messages],
  );

  const sortedSessions = sessions.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return (
    <aside
      className={`aiPanel ${showSettings ? "aiPanelSettingsView" : ""} ${visible ? "" : "hidden"}`}
    >
      <div className="panelHead aiPanelHead">
        <div className="aiPanelTitleWrap">
          <h2 className="aiPanelTitle">
            <Bot size={18} /> AI Chat
          </h2>
          {!showSettings && !showHistory && activeSession?.title !== "New chat" && (
            <span className="aiPanelSubtitle">{activeSession?.title}</span>
          )}
        </div>
        <div className="rowActions">
          {streaming && (
            <button onClick={stop} title="Stop generating">
              <Square size={16} />
            </button>
          )}
          <button onClick={newChat} title="New chat" disabled={streaming}>
            <Plus size={16} />
          </button>
          <button
            className={showHistory ? "active" : ""}
            onClick={() => {
              setShowSettings(false);
              setShowHistory(!showHistory);
            }}
            title="Chat history"
          >
            <History size={16} />
          </button>
          <button
            className={showSettings ? "active" : ""}
            onClick={() => {
              setShowHistory(false);
              setShowSettings(!showSettings);
            }}
            title="AI provider settings"
          >
            <Settings2 size={16} />
          </button>
          <button onClick={onClose} title="Close AI panel">
            <X size={16} />
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="aiPanelBody aiSessionsBody">
          <div className="aiSessionsList">
            {sortedSessions.map((s) => (
              <div key={s.id} className={`aiSessionItem ${s.id === activeId ? "active" : ""}`}>
                <button className="aiSessionOpen" onClick={() => openSession(s.id)}>
                  <div className="aiSessionTitle">{s.title || "New chat"}</div>
                  <div className="aiSessionMeta">
                    {s.messages.filter((m) => m.role !== "system").length} messages
                    {s.model ? ` · ${s.model}` : ""}
                  </div>
                </button>
                <button
                  className="aiSessionDelete"
                  title="Delete chat"
                  onClick={() => deleteSession(s.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : showSettings ? (
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
              <div className="aiModelPickerWrap" ref={modelPickerRef}>
                <button
                  className="aiModelPickerBtn"
                  onClick={() => (showModelPicker ? setShowModelPicker(false) : openModelPicker())}
                  title="Switch provider / model"
                >
                  {settings?.model
                    ? `${aiProviderLabel(settings.provider)} · ${settings.model}`
                    : "Select model"}{" "}
                  <ChevronDown size={12} />
                </button>
                {showModelPicker && draft && (
                  <div className="aiModelPopover">
                    <label className="aiModelProviderRow">
                      Provider
                      <select
                        value={draft.provider || "openai"}
                        onChange={(e) => changeDraftProvider(e.target.value)}
                      >
                        {Object.keys(aiProviderDefaults).map((provider) => (
                          <option key={provider} value={provider}>
                            {aiProviderLabel(provider)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {aiProviderRequiresKey(draft.provider) && (
                      <div className="aiModelKeyRow">
                        <input
                          type="password"
                          value={draft.apiKey || ""}
                          placeholder="API key"
                          spellCheck={false}
                          autoComplete="off"
                          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                        />
                        <button
                          onClick={connectDraft}
                          disabled={!draft.apiKey || modelLoading}
                          title="Connect"
                        >
                          <PlugZap size={13} />
                        </button>
                      </div>
                    )}
                    <div className="aiModelSearchRow">
                      <Search size={13} />
                      <input
                        autoFocus
                        value={modelSearch}
                        placeholder="Search models"
                        onChange={(e) => setModelSearch(e.target.value)}
                      />
                    </div>
                    <div className="aiModelList">
                      {modelLoading && (
                        <div className="aiModelStatus">
                          <Loader2 size={13} className="spin" /> Loading models…
                        </div>
                      )}
                      {!modelLoading && modelError && (
                        <div className="aiModelStatus aiModelStatusErr">{modelError}</div>
                      )}
                      {!modelLoading &&
                        !modelError &&
                        aiProviderRequiresKey(draft.provider) &&
                        !draft.apiKey && (
                          <div className="aiModelStatus">Enter an API key to load models.</div>
                        )}
                      {!modelLoading &&
                        !modelError &&
                        modelOptions.length === 0 &&
                        (!aiProviderRequiresKey(draft.provider) || draft.apiKey) && (
                          <div className="aiModelStatus">No models found.</div>
                        )}
                      {!modelLoading &&
                        modelOptions
                          .filter((m) => m.toLowerCase().includes(modelSearch.trim().toLowerCase()))
                          .map((m) => (
                            <button
                              key={m}
                              className={`aiModelOption ${
                                m === settings?.model && draft.provider === settings?.provider
                                  ? "active"
                                  : ""
                              }`}
                              onClick={() => confirmModel(m)}
                            >
                              {m}
                              {m === settings?.model && draft.provider === settings?.provider && (
                                <Check size={13} />
                              )}
                            </button>
                          ))}
                    </div>
                  </div>
                )}
              </div>
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
