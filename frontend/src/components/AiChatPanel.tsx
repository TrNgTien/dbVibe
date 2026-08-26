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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Kbd } from "@/components/ui/kbd";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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

export const AiChatPanel = forwardRef<
  { ask(text: string): void },
  {
    detail: any;
    connection?: any;
    onClose: () => void;
    onInsertQuery: (sql: string) => void;
    onToast: (message: string) => void;
    visible: boolean;
  }
>(function AiChatPanel(
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
      className={cn(
        "flex min-h-0 flex-col overflow-hidden border-l border-border bg-card",
        !visible && "hidden",
      )}
    >
      <div className="flex min-h-[45px] flex-none items-center justify-between gap-3 border-b border-border px-3 py-[9px]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
            <Bot className="size-4.5" /> AI Chat
          </h2>
          {!showSettings && !showHistory && activeSession?.title !== "New chat" && (
            <span className="max-w-[220px] truncate pl-[25px] text-[11px] text-muted-foreground">
              {activeSession?.title}
            </span>
          )}
        </div>
        <div className="flex flex-none items-center gap-1">
          {streaming && (
            <Button
              variant="outline"
              size="icon-sm"
              className="size-[30px]"
              onClick={stop}
              title="Stop generating"
            >
              <Square />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            className="size-[30px]"
            onClick={newChat}
            disabled={streaming}
            title="New chat"
          >
            <Plus />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className={cn(
              "size-[30px]",
              showHistory && "border-primary text-primary",
            )}
            onClick={() => {
              setShowSettings(false);
              setShowHistory(!showHistory);
            }}
            title="Chat history"
          >
            <History />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className={cn(
              "size-[30px]",
              showSettings && "border-primary text-primary",
            )}
            onClick={() => {
              setShowHistory(false);
              setShowSettings(!showSettings);
            }}
            title="AI provider settings"
          >
            <Settings2 />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="size-[30px]"
            onClick={onClose}
            title="Close AI panel"
          >
            <X />
          </Button>
        </div>
      </div>

      {showHistory ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="flex flex-col gap-1">
            {sortedSessions.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "flex items-stretch gap-1 rounded-lg border border-transparent",
                  s.id === activeId && "border-primary bg-accent",
                  s.id !== activeId && "hover:bg-muted",
                )}
              >
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-2"
                  onClick={() => openSession(s.id)}
                >
                  <span className="w-full truncate text-[13px] text-foreground">
                    {s.title || "New chat"}
                  </span>
                  <span className="w-full truncate text-[11px] text-muted-foreground">
                    {s.messages.filter((m) => m.role !== "system").length} messages
                    {s.model ? ` · ${s.model}` : ""}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="flex-none text-muted-foreground hover:text-red-400"
                  title="Delete chat"
                  onClick={() => deleteSession(s.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : showSettings ? (
        <div className="min-h-0 flex-1 gap-1 overflow-y-auto p-4">
          <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">
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
          <div className="mt-3.5">
            <Button
              className="w-full"
              onClick={saveSettings}
              disabled={!settings?.model || !testOk}
              title={
                settings?.model && testOk
                  ? "Save provider and start chatting"
                  : 'Run "Test connection" successfully first, then save'
              }
            >
              <Check data-icon="inline-start" /> Save & Start Chat
            </Button>
          </div>
        </div>
      ) : settings === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-3.5" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="m-auto flex flex-col items-center gap-2 p-5 text-center text-muted-foreground">
                <Sparkles className="mb-1 size-5 text-amber-400" />
                <p className="text-sm">Ask about a query, schema, or error.</p>
                <p className="max-w-60 text-xs leading-relaxed text-muted-foreground/80">
                  Select SQL in the editor and press <Kbd>Cmd</Kbd>+<Kbd>L</Kbd>, or
                  type a question below.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className="flex flex-col gap-1.5">
                <div
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
                    message.role === "user" && "text-amber-400",
                  )}
                >
                  {message.role === "user" ? "You" : "AI"}
                </div>
                <div
                  className={cn(
                    "rounded-lg border border-border p-2.5 text-[13px] leading-relaxed text-foreground",
                    message.role === "user" ? "bg-accent" : "bg-muted/50",
                  )}
                >
                  {message.content ? (
                    <Markdown text={message.content} onInsert={onInsertQuery} />
                  ) : message.streaming ? (
                    <span className="inline-flex items-center text-muted-foreground">
                      <Loader2 className="mr-1 size-3.5 animate-spin" />
                    </span>
                  ) : null}
                </div>
                {message.role === "assistant" && message.content && (
                  <div className="self-start">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-primary"
                      onClick={() => copyText(message.content)}
                    >
                      <Copy data-icon="inline-start" className="size-3" /> Copy
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-border bg-muted/20 p-2.5">
            {!configured && !streaming && (
              <Button
                variant="outline"
                className="w-full border-dashed border-primary text-primary hover:bg-accent hover:text-primary"
                onClick={() => setShowSettings(true)}
              >
                <Settings2 data-icon="inline-start" className="size-3.5" /> Configure AI
                provider to start chatting
              </Button>
            )}
            <Textarea
              value={input}
              placeholder="Ask about a query, schema, or error..."
              rows={3}
              className="min-h-20 resize-none bg-background"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <ModelPicker
                open={showModelPicker}
                onOpenChange={(open) => {
                  if (open) openModelPicker();
                  setShowModelPicker(open);
                }}
                draft={draft}
                settings={settings}
                modelLoading={modelLoading}
                modelError={modelError}
                modelOptions={modelOptions}
                modelSearch={modelSearch}
                setModelSearch={setModelSearch}
                changeDraftProvider={changeDraftProvider}
                setDraft={setDraft}
                connectDraft={connectDraft}
                confirmModel={confirmModel}
              />
              <span className="text-[11px] text-muted-foreground">
                Enter to send · Shift+Enter for newline
              </span>
              <Button
                onClick={() => send(input)}
                disabled={!input.trim() || streaming}
              >
                {streaming ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Send data-icon="inline-start" />
                )}
                Send
              </Button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
});

function ModelPicker({
  open,
  onOpenChange,
  draft,
  settings,
  modelLoading,
  modelError,
  modelOptions,
  modelSearch,
  setModelSearch,
  changeDraftProvider,
  setDraft,
  connectDraft,
  confirmModel,
}) {
  const filteredModels = (modelOptions || []).filter((m) =>
    m.toLowerCase().includes(modelSearch.trim().toLowerCase()),
  );
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-[160px] justify-between text-muted-foreground hover:text-foreground"
          title="Switch provider / model"
        >
          <span className="truncate">
            {settings?.model
              ? `${aiProviderLabel(settings.provider)} · ${settings.model}`
              : "Select model"}
          </span>
          <ChevronDown className="size-3 flex-none text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 p-0">
        {draft && (
          <>
            <div className="flex flex-col gap-1 px-2.5 pb-0 pt-2 text-[11px] text-muted-foreground">
              Provider
              <NativeSelect
                size="sm"
                value={draft.provider || "openai"}
                onChange={(e) => changeDraftProvider(e.target.value)}
              >
                {Object.keys(aiProviderDefaults).map((provider) => (
                  <option key={provider} value={provider}>
                    {aiProviderLabel(provider)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {aiProviderRequiresKey(draft.provider) && (
              <div className="px-2.5 pt-2">
                <InputGroup>
                  <InputGroupInput
                    type="password"
                    value={draft.apiKey || ""}
                    placeholder="API key"
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  />
                  <InputGroupButton
                    variant="outline"
                    size="icon-sm"
                    onClick={connectDraft}
                    disabled={!draft.apiKey || modelLoading}
                    title="Connect"
                  >
                    <PlugZap className="size-3.5" />
                  </InputGroupButton>
                </InputGroup>
              </div>
            )}
            <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2 text-muted-foreground">
              <Search className="size-3.5" />
              <Input
                autoFocus
                value={modelSearch}
                placeholder="Search models"
                className="h-6 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
                onChange={(e) => setModelSearch(e.target.value)}
              />
            </div>
            <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-1">
              {modelLoading && (
                <div className="flex items-center gap-1.5 p-2.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading models…
                </div>
              )}
              {!modelLoading && modelError && (
                <div className="p-2.5 text-xs text-red-400">{modelError}</div>
              )}
              {!modelLoading &&
                !modelError &&
                aiProviderRequiresKey(draft.provider) &&
                !draft.apiKey && (
                  <div className="p-2.5 text-xs text-muted-foreground">
                    Enter an API key to load models.
                  </div>
                )}
              {!modelLoading &&
                !modelError &&
                modelOptions.length === 0 &&
                (!aiProviderRequiresKey(draft.provider) || draft.apiKey) && (
                  <div className="p-2.5 text-xs text-muted-foreground">No models found.</div>
                )}
              {!modelLoading &&
                filteredModels.map((m) => {
                  const active = m === settings?.model && draft.provider === settings?.provider;
                  return (
                    <Button
                      key={m}
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "w-full justify-between rounded-md px-2 py-1.5 text-xs font-normal",
                        active ? "text-primary" : "text-foreground",
                      )}
                      onClick={() => confirmModel(m)}
                    >
                      {m}
                      {active && <Check className="size-3.5" />}
                    </Button>
                  );
                })}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}