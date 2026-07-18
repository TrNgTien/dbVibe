import React from "react";
import { Database, Plus, Search, Pin, PinOff } from "lucide-react";
import { DriverLogo, StatusDot } from "../components/common";
import { isLocalConnection } from "../utils/api";

export function StartupPage({
  connections,
  filter,
  setFilter,
  onSelect,
  onCreate,
  onTogglePin,
}) {
  return (
    <div className="startup">
      <aside className="startupIntro">
        <div className="startupLogo">
          <Database size={76} />
        </div>
        <h1>dbVibe</h1>
        <p>MySQL / PostgreSQL / TimescaleDB / Redis / Elasticsearch / MongoDB</p>
        <button className="primary startupButton" onClick={onCreate}>
          <Plus size={18} /> Create Connection
        </button>
      </aside>

      <main className="startupMain">
        <div className="startupToolbar">
          <button title="Create connection" onClick={onCreate}>
            <Plus size={18} />
          </button>
          <label className="startupSearch">
            <Search size={18} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search for connection..."
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="startupList">
          {connections.map((conn) => (
            <button
              key={conn.id}
              className="startupConnection"
              onClick={() => onSelect(conn)}
            >
              <DriverLogo driver={conn.driver} />
              <span>
                <strong>{conn.name}</strong>
                <small>
                  {conn.host}:{conn.port}
                  {conn.database ? `/${conn.database}` : ""}
                </small>
              </span>
              {isLocalConnection(conn) && (
                <small className="localBadge">
                  <StatusDot status="connected" /> local
                </small>
              )}
              <button
                className="iconButton"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(conn);
                }}
                title={conn.isPinned ? "Unpin" : "Pin"}
                style={{ marginLeft: isLocalConnection(conn) ? 0 : "auto" }}
              >
                <Pin size={16} fill={conn.isPinned ? "currentColor" : "none"} />
              </button>
            </button>
          ))}
          {!connections.length && (
            <div className="startupEmpty">
              <Database size={28} />
              <span>No connections found</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
