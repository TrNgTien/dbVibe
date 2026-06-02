import React from "react";
import { KeyRound, Settings } from "lucide-react";

export function SettingsPanel({ shortcuts, setShortcuts, generalSettings, setGeneralSettings }) {
  return (
    <section className="panel settingsPanel">
      <div className="panelHead">
        <h2>
          <Settings size={16} /> General Settings
        </h2>
      </div>
      <div className="settingsGrid">
        <label>
          Auto delete stored queries older than
          <select
            value={generalSettings.autoDeleteQueryDays}
            onChange={(e) => setGeneralSettings({ ...generalSettings, autoDeleteQueryDays: Number(e.target.value) })}
          >
            <option value={0}>Never</option>
            <option value={15}>15 days</option>
            <option value={30}>30 days</option>
          </select>
        </label>
        <label>
          Editor Font Size
          <input
            type="number"
            min="10"
            max="32"
            value={generalSettings.editorFontSize || 14}
            onChange={(e) => setGeneralSettings({ ...generalSettings, editorFontSize: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="panelHead" style={{ marginTop: 16 }}>
        <h2>
          <KeyRound size={16} /> Shortcuts
        </h2>
      </div>
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
    </section>
  );
}