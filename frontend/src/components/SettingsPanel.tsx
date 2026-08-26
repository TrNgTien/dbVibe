import React from "react";
import { Database, KeyRound, Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export function SettingsPanel({
  shortcuts,
  setShortcuts,
  generalSettings,
  setGeneralSettings,
  onSave,
  onCancel,
}: {
  shortcuts: Record<string, string>;
  setShortcuts: (next: Record<string, string>) => void;
  generalSettings: Record<string, any>;
  setGeneralSettings: (next: Record<string, any>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const updateSetting = (key, value) =>
    setGeneralSettings({ ...generalSettings, [key]: value });

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="flex max-h-[min(760px,calc(100vh-4rem))] w-[min(75vw,calc(100vw-3.5rem))] max-w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="min-h-[48px] flex-row items-center gap-3 border-b border-border p-[10px_12px]">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Settings className="size-4" /> Settings
          </DialogTitle>
          <DialogDescription className="sr-only">
            Application configuration
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3.5 overflow-y-auto p-3.5">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <h3 className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
              Editor
            </h3>
            <FieldGroup className="grid grid-cols-2 gap-2.5 p-3">
              <Field>
                <FieldLabel>Editor Font Size</FieldLabel>
                <Input
                  type="number"
                  min="10"
                  max="32"
                  value={generalSettings.editorFontSize ?? 14}
                  onChange={(e) => updateSetting("editorFontSize", Number(e.target.value))}
                />
              </Field>
              <Field>
                <FieldLabel>Tab Width</FieldLabel>
                <NativeSelect
                  value={generalSettings.tabWidth ?? 4}
                  onChange={(e) => updateSetting("tabWidth", Number(e.target.value))}
                >
                  <option value={2}>2 spaces</option>
                  <option value={4}>4 spaces</option>
                  <option value={8}>8 spaces</option>
                </NativeSelect>
              </Field>
              <Field orientation="horizontal" className="items-center gap-2">
                <Switch
                  id="setting-line-numbers"
                  checked={generalSettings.showLineNumbers ?? true}
                  onCheckedChange={(checked) => updateSetting("showLineNumbers", checked)}
                />
                <FieldLabel htmlFor="setting-line-numbers">
                  Show line numbers
                </FieldLabel>
              </Field>
              <Field orientation="horizontal" className="items-center gap-2">
                <Switch
                  id="setting-highlight-line"
                  checked={generalSettings.highlightCurrentLine ?? true}
                  onCheckedChange={(checked) => updateSetting("highlightCurrentLine", checked)}
                />
                <FieldLabel htmlFor="setting-highlight-line">
                  Highlight current line
                </FieldLabel>
              </Field>
              <Field orientation="horizontal" className="items-center gap-2">
                <Switch
                  id="setting-word-wrap"
                  checked={generalSettings.wordWrap ?? true}
                  onCheckedChange={(checked) => updateSetting("wordWrap", checked)}
                />
                <FieldLabel htmlFor="setting-word-wrap">Word wrap</FieldLabel>
              </Field>
              <Field orientation="horizontal" className="items-center gap-2">
                <Switch
                  id="setting-uppercase"
                  checked={generalSettings.uppercaseKeywords ?? false}
                  onCheckedChange={(checked) => updateSetting("uppercaseKeywords", checked)}
                />
                <FieldLabel htmlFor="setting-uppercase">
                  Uppercase autocomplete keywords
                </FieldLabel>
              </Field>
            </FieldGroup>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <h3 className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
              <Database className="size-3.5" /> Data Grid
            </h3>
            <FieldGroup className="grid grid-cols-2 gap-2.5 p-3">
              <Field>
                <FieldLabel>Default SELECT Limit</FieldLabel>
                <NativeSelect
                  value={generalSettings.defaultSelectLimit ?? 100}
                  onChange={(e) => updateSetting("defaultSelectLimit", Number(e.target.value))}
                >
                  <option value={100}>100 rows</option>
                  <option value={300}>300 rows</option>
                  <option value={500}>500 rows</option>
                  <option value={1000}>1,000 rows</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel>Query Result Limit</FieldLabel>
                <NativeSelect
                  value={generalSettings.queryResultLimit ?? 500}
                  onChange={(e) => updateSetting("queryResultLimit", Number(e.target.value))}
                >
                  <option value={100}>100 rows</option>
                  <option value={300}>300 rows</option>
                  <option value={500}>500 rows</option>
                  <option value={1000}>1,000 rows</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel>Row Density</FieldLabel>
                <NativeSelect
                  value={generalSettings.resultRowDensity ?? "normal"}
                  onChange={(e) => updateSetting("resultRowDensity", e.target.value)}
                >
                  <option value="compact">Compact</option>
                  <option value="normal">Normal</option>
                  <option value="comfortable">Comfortable</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel>NULL Display</FieldLabel>
                <Input
                  maxLength={20}
                  value={generalSettings.nullDisplay ?? "NULL"}
                  onChange={(e) =>
                    updateSetting(
                      "nullDisplay",
                      e.target.value.replace(/[\r\n\t]/g, ""),
                    )
                  }
                />
              </Field>
              <Field orientation="horizontal" className="items-center gap-2">
                <Switch
                  id="setting-alternate-rows"
                  checked={generalSettings.showAlternateRows ?? true}
                  onCheckedChange={(checked) => updateSetting("showAlternateRows", checked)}
                />
                <FieldLabel htmlFor="setting-alternate-rows">
                  Show alternate row backgrounds
                </FieldLabel>
              </Field>
            </FieldGroup>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <h3 className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
              <KeyRound className="size-3.5" /> Shortcuts
            </h3>
            <FieldGroup className="grid grid-cols-2 gap-2.5 p-3">
              {Object.entries(shortcuts).map(([key, value]) => (
                <Field key={key}>
                  <FieldLabel>{key}</FieldLabel>
                  <Input
                    className="font-mono text-xs"
                    value={value}
                    onChange={(e) =>
                      setShortcuts({ ...shortcuts, [key]: e.target.value })
                    }
                  />
                </Field>
              ))}
            </FieldGroup>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <h3 className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
              General
            </h3>
            <FieldGroup className="grid grid-cols-2 gap-2.5 p-3">
              <Field>
                <FieldLabel>Auto delete stored queries older than</FieldLabel>
                <NativeSelect
                  value={generalSettings.autoDeleteQueryDays ?? 0}
                  onChange={(e) => updateSetting("autoDeleteQueryDays", Number(e.target.value))}
                >
                  <option value={0}>Never</option>
                  <option value={15}>15 days</option>
                  <option value={30}>30 days</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel>Redis result refresh interval</FieldLabel>
                <NativeSelect
                  value={generalSettings.redisRefreshSeconds ?? 0}
                  onChange={(e) => updateSetting("redisRefreshSeconds", Number(e.target.value))}
                >
                  <option value={0}>Off</option>
                  <option value={1}>1 second</option>
                  <option value={2}>2 seconds</option>
                  <option value={5}>5 seconds</option>
                  <option value={10}>10 seconds</option>
                  <option value={30}>30 seconds</option>
                </NativeSelect>
              </Field>
            </FieldGroup>
          </section>
        </div>

        <DialogFooter className="border-t border-border px-3.5 py-3">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave}>Save Settings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}