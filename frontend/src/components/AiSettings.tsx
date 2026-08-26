import React, { useState } from "react";
import { Loader2, PlugZap } from "lucide-react";
import { aiProviderDefaults, aiProviderLabel, api } from "../utils/api";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";

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
    <FieldGroup className="gap-3">
      <Field>
        <FieldLabel>Provider</FieldLabel>
        <NativeSelect
          value={settings.provider || "openai"}
          onChange={(e) => changeProvider(e.target.value)}
        >
          {Object.keys(aiProviderDefaults).map((provider) => (
            <option key={provider} value={provider}>
              {aiProviderLabel(provider)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel>Base URL</FieldLabel>
        <Input
          value={settings.baseUrl || ""}
          placeholder={aiProviderDefaults[settings.provider]?.baseUrl || "https://api.example.com/v1"}
          spellCheck={false}
          onChange={(e) => update("baseUrl", e.target.value)}
        />
      </Field>
      {requiresKey !== false && (
        <Field>
          <FieldLabel>API Key</FieldLabel>
          <Input
            type="password"
            value={settings.apiKey || ""}
            placeholder="sk-..."
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => update("apiKey", e.target.value)}
          />
        </Field>
      )}
      <Field>
        <FieldLabel>Model</FieldLabel>
        <Input
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
      </Field>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={test} disabled={testing}>
          {testing ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <PlugZap data-icon="inline-start" />
          )}
          {testing ? "Testing..." : "Test connection"}
        </Button>
        {result && (
          <p
            className={
              result.startsWith("Connected")
                ? "text-xs text-emerald-400"
                : "whitespace-pre-wrap text-xs text-red-400"
            }
          >
            {result}
          </p>
        )}
      </div>
    </FieldGroup>
  );
}