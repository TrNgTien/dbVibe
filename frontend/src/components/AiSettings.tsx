import React, { useState } from "react";
import { Loader2, PlugZap } from "lucide-react";
import { aiProviderDefaults, aiProviderLabel, api } from "../utils/api";

export function AiSettingsForm({ settings, onChange, onToast, onTested }) {
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState([]);
  const [result, setResult] = useState("");

  const update = (key, value) => onChange({ ...settings, [key]: value });

  function changeProvider(provider) {
    const defaults = aiProviderDefaults[provider] || {};
    onChange({
      ...settings,
      provider,
      baseUrl: defaults.baseUrl || "",
      model: settings.model && settings.provider === provider ? settings.model : defaults.model || "",
    });
  }

  async function test() {
    setTesting(true);
    setResult("");
    setModels([]);
    try {
      const list = await api.call("TestAIModels", settings);
      setModels(list || []);
      setResult(
        list?.length
          ? `Connected. ${list.length} model${list.length === 1 ? "" : "s"} available.`
          : "Connected.",
      );
      onToast?.(`Connected to ${aiProviderLabel(settings.provider)}`);
      onTested?.(true);
    } catch (err) {
      setResult(err?.message || String(err));
      onTested?.(false);
    } finally {
      setTesting(false);
    }
  }

  const requiresKey = aiProviderDefaults[settings.provider]?.requiresKey;

  return (
    <div className="aiSettingsForm">
      <label>
        Provider
        <select value={settings.provider || "openai"} onChange={(e) => changeProvider(e.target.value)}>
          {Object.keys(aiProviderDefaults).map((provider) => (
            <option key={provider} value={provider}>
              {aiProviderLabel(provider)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Base URL
        <input
          value={settings.baseUrl || ""}
          placeholder={aiProviderDefaults[settings.provider]?.baseUrl || "https://api.example.com/v1"}
          spellCheck={false}
          onChange={(e) => update("baseUrl", e.target.value)}
        />
      </label>
      {requiresKey !== false && (
        <label>
          API Key
          <input
            type="password"
            value={settings.apiKey || ""}
            placeholder="sk-..."
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => update("apiKey", e.target.value)}
          />
        </label>
      )}
      <label>
        Model
        <input
          value={settings.model || ""}
          placeholder={aiProviderDefaults[settings.provider]?.model || "model name"}
          list="ai-model-options"
          spellCheck={false}
          onChange={(e) => update("model", e.target.value)}
        />
        {models.length > 0 && (
          <datalist id="ai-model-options">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        )}
      </label>
      <div className="rowActions aiSettingsActions">
        <button onClick={test} disabled={testing}>
          {testing ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}
          {testing ? "Testing..." : "Test connection"}
        </button>
      </div>
      {result && <p className={result.startsWith("Connected") ? "aiSettingsOk" : "aiSettingsErr"}>{result}</p>}
    </div>
  );
}
