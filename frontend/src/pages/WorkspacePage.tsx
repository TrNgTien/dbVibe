import React, { useState } from "react";
import {
  Download,
  FolderPlus,
  Pencil,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";

export function WorkspacePage({
  workspaces,
  selected,
  onCreate,
  onImport,
  onExport,
  onRename,
  onDelete,
}) {
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [newName, setNewName] = useState("");

  const currentWorkspace = selected
    ? workspaces.find((w) => w.id === selected.workspaceId)
    : null;

  const startRename = (ws) => {
    setEditingId(ws.id);
    setDraftName(ws.name);
  };

  const submitRename = (ws) => {
    const name = draftName.trim();
    if (name && name !== ws.name) onRename(ws.id, name);
    setEditingId(null);
  };

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName("");
  };

  return (
    <section className="workspacePage">
      <section className="panel workspacePanel">
        <div className="panelHead">
          <div>
            <h2>Workspaces</h2>
            <small>Organize connections and share them via import/export</small>
          </div>
          <div className="rowActions">
            <button onClick={onImport}>
              <Download size={15} /> Import
            </button>
          </div>
        </div>

        <div className="newWorkspace">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="New workspace name..."
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button
            className="primary"
            onClick={create}
            disabled={!newName.trim()}
          >
            <FolderPlus size={15} /> Create
          </button>
        </div>

        <div className="workspaceList">
          {workspaces.map((ws) => {
            const active = currentWorkspace?.id === ws.id;
            const editing = editingId === ws.id;
            return (
              <div
                className={`workspaceRow ${active ? "active" : ""}`}
                key={ws.id}
              >
                {editing ? (
                  <>
                    <input
                      autoFocus
                      className="workspaceRenameInput"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitRename(ws);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <div className="rowActions">
                      <button
                        className="primary"
                        title="Save name"
                        onClick={() => submitRename(ws)}
                      >
                        <Save size={14} />
                      </button>
                      <button
                        title="Cancel"
                        onClick={() => setEditingId(null)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="workspaceRowName">
                      <strong>{ws.name}</strong>
                      {active && <small>current</small>}
                    </span>
                    <div className="rowActions">
                      <button title="Rename" onClick={() => startRename(ws)}>
                        <Pencil size={14} />
                      </button>
                      <button
                        title="Export workspace"
                        onClick={() => onExport(ws.id)}
                      >
                        <Upload size={14} />
                      </button>
                      <button title="Delete" onClick={() => onDelete(ws.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {!workspaces.length && (
            <div className="empty workspaceEmpty">
              <FolderPlus size={28} />
              <p>No workspaces yet</p>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
