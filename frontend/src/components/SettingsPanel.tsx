import React from "react";
import { Database, KeyRound, Settings, X } from "lucide-react";

export function SettingsPanel({
  shortcuts,
  setShortcuts,
  generalSettings,
  setGeneralSettings,
  onSave,
  onCancel,
}) {
  const updateSetting = (key, value) =>
    setGeneralSettings({ ...generalSettings, [key]: value });

  return (
    <div className="settingsBackdrop" onMouseDown={onCancel}>
      <section
        className="settingsWindow"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settingsWindowHead">
          <div>
            <h2>
              <Settings size={17} /> Settings
            </h2>
            <span>Application configuration</span>
          </div>
          <button className="iconButton" title="Close settings" onClick={onCancel}>
            <X size={17} />
          </button>
        </div>

        <div className="settingsWindowBody">
          <div className="settingsSection">
            <h3>Editor</h3>
            <div className="settingsGrid">
        <label>
          Editor Font Size
          <input
            type="number"
            min="10"
            max="32"
            value={generalSettings.editorFontSize ?? 14}
            onChange={(e) => updateSetting("editorFontSize", Number(e.target.value))}
          />
        </label>
        <label>
          Tab Width
          <select
            value={generalSettings.tabWidth ?? 4}
            onChange={(e) => updateSetting("tabWidth", Number(e.target.value))}
          >
            <option value={2}>2 spaces</option>
            <option value={4}>4 spaces</option>
            <option value={8}>8 spaces</option>
          </select>
        </label>
        <label className="settingToggle">
          <input
            type="checkbox"
            checked={generalSettings.showLineNumbers ?? true}
            onChange={(e) => updateSetting("showLineNumbers", e.target.checked)}
          />
          Show line numbers
        </label>
        <label className="settingToggle">
          <input
            type="checkbox"
            checked={generalSettings.highlightCurrentLine ?? true}
            onChange={(e) => updateSetting("highlightCurrentLine", e.target.checked)}
          />
          Highlight current line
        </label>
        <label className="settingToggle">
          <input
            type="checkbox"
            checked={generalSettings.wordWrap ?? true}
            onChange={(e) => updateSetting("wordWrap", e.target.checked)}
          />
          Word wrap
        </label>
        <label className="settingToggle">
          <input
            type="checkbox"
            checked={generalSettings.uppercaseKeywords ?? false}
            onChange={(e) => updateSetting("uppercaseKeywords", e.target.checked)}
          />
          Uppercase autocomplete keywords
        </label>
            </div>
          </div>

          <div className="settingsSection">
            <h3>
              <Database size={15} /> Data Grid
            </h3>
            <div className="settingsGrid">
        <label>
          Default SELECT Limit
          <select
            value={generalSettings.defaultSelectLimit ?? 100}
            onChange={(e) => updateSetting("defaultSelectLimit", Number(e.target.value))}
          >
            <option value={100}>100 rows</option>
            <option value={300}>300 rows</option>
            <option value={500}>500 rows</option>
            <option value={1000}>1,000 rows</option>
          </select>
        </label>
        <label>
          Query Result Limit
          <select
            value={generalSettings.queryResultLimit ?? 500}
            onChange={(e) => updateSetting("queryResultLimit", Number(e.target.value))}
          >
            <option value={100}>100 rows</option>
            <option value={300}>300 rows</option>
            <option value={500}>500 rows</option>
            <option value={1000}>1,000 rows</option>
          </select>
        </label>
        <label>
          Row Density
          <select
            value={generalSettings.resultRowDensity ?? "normal"}
            onChange={(e) => updateSetting("resultRowDensity", e.target.value)}
          >
            <option value="compact">Compact</option>
            <option value="normal">Normal</option>
            <option value="comfortable">Comfortable</option>
          </select>
        </label>
        <label>
          NULL Display
          <input
            maxLength={20}
            value={generalSettings.nullDisplay ?? "NULL"}
            onChange={(e) => updateSetting("nullDisplay", e.target.value.replace(/[\r\n\t]/g, ""))}
          />
        </label>
        <label className="settingToggle">
          <input
            type="checkbox"
            checked={generalSettings.showAlternateRows ?? true}
            onChange={(e) => updateSetting("showAlternateRows", e.target.checked)}
          />
          Show alternate row backgrounds
        </label>
            </div>
          </div>

          <div className="settingsSection">
            <h3>
              <KeyRound size={15} /> Shortcuts
            </h3>
            <div className="settingsGrid">
        {Object.entries(shortcuts).map(([key, value]) => (
          <label key={key}>
            {key}
            <input
              value={value}
              onChange={(e) =>
                setShortcuts({ ...shortcuts, [key]: e.target.value })
              }
            />
          </label>
        ))}
            </div>
          </div>

          <div className="settingsSection">
            <h3>General</h3>
            <div className="settingsGrid">
        <label>
          Auto delete stored queries older than
          <select
            value={generalSettings.autoDeleteQueryDays ?? 0}
            onChange={(e) => updateSetting("autoDeleteQueryDays", Number(e.target.value))}
          >
            <option value={0}>Never</option>
            <option value={15}>15 days</option>
            <option value={30}>30 days</option>
          </select>
        </label>
        <label>
          Redis result refresh interval
          <select
            value={generalSettings.redisRefreshSeconds ?? 0}
            onChange={(e) => updateSetting("redisRefreshSeconds", Number(e.target.value))}
          >
            <option value={0}>Off</option>
            <option value={1}>1 second</option>
            <option value={2}>2 seconds</option>
            <option value={5}>5 seconds</option>
            <option value={10}>10 seconds</option>
            <option value={30}>30 seconds</option>
          </select>
        </label>
            </div>
          </div>
        </div>

        <div className="settingsWindowFoot">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={onSave}>
            Save Settings
          </button>
        </div>
      </section>
      </div>
  );
}
