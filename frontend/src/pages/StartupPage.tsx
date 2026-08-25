import React from "react";
import {
  Database,
  Download,
  FolderPlus,
  Plus,
  Search,
  Trash2,
  Upload,
  ChevronDown,
  ChevronRight,
  Pin,
  PinOff,
} from "lucide-react";
import { DriverLogo, StatusDot } from "../components/common";
import { isLocalConnection } from "../utils/api";

export function StartupPage({
  groups,
  expandedWorkspaces,
  onToggleWorkspace,
  filter,
  setFilter,
  onSelect,
  onCreate,
  onTogglePin,
  onCreateWorkspace,
  onImportWorkspace,
  onExportWorkspace,
  onDeleteWorkspace,
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
          <button title="New workspace" onClick={onCreateWorkspace}>
            <FolderPlus size={18} />
          </button>
          <button title="Import workspace" onClick={onImportWorkspace}>
            <Download size={18} />
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
          {groups.map((group) => {
            const expanded = group.isUngrouped
              ? true
              : !!expandedWorkspaces[group.id];
            return (
              <div key={group.id || "ungrouped"} className="startupGroup">
                <div
                  className={`startupGroupHeader ${group.isUngrouped ? "muted" : ""}`}
                  role={group.isUngrouped ? undefined : "button"}
                  tabIndex={group.isUngrouped ? undefined : 0}
                  aria-expanded={group.isUngrouped ? undefined : expanded}
                  onClick={
                    group.isUngrouped
                      ? undefined
                      : () => onToggleWorkspace(group.id)
                  }
                  onKeyDown={
                    group.isUngrouped
                      ? undefined
                      : (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onToggleWorkspace(group.id);
                          }
                        }
                  }
                >
                  {group.isUngrouped ? (
                    <span className="startupGroupChevron" />
                  ) : (
                    <span className="startupGroupChevron">
                      {expanded ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                    </span>
                  )}
                  <strong>{group.name}</strong>
                  <small>{group.connections.length}</small>
                  {!group.isUngrouped && (
                    <span className="startupGroupActions">
                      {group.connections.length > 0 && (
                        <button
                          className="iconButton"
                          title="Export workspace"
                          onClick={(e) => {
                            e.stopPropagation();
                            onExportWorkspace(group.id);
                          }}
                        >
                          <Upload size={15} />
                        </button>
                      )}
                      <button
                        className="iconButton"
                        title="Delete workspace"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteWorkspace(group.id);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  )}
                </div>
                {expanded &&
                  group.connections.map((conn) => (
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
                        style={{
                          marginLeft: isLocalConnection(conn) ? 0 : "auto",
                        }}
                      >
                        <Pin
                          size={16}
                          fill={conn.isPinned ? "currentColor" : "none"}
                        />
                      </button>
                    </button>
                  ))}
              </div>
            );
          })}
          {!groups.some((g) => g.connections.length) && (
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
