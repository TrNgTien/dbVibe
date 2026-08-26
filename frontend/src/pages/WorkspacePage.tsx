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
import { Page, Panel, PanelHeader } from "../components/shared/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

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
    <Page>
      <Panel>
        <PanelHeader
          title="Workspaces"
          description="Organize connections and share them via import/export"
          actions={
            <Button variant="outline" size="sm" onClick={onImport}>
              <Download data-icon="inline-start" /> Import
            </Button>
          }
        />

        <div className="flex gap-2 px-2.5 pt-2.5">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="New workspace name..."
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <Button onClick={create} disabled={!newName.trim()}>
            <FolderPlus data-icon="inline-start" /> Create
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2.5">
          {workspaces.map((ws) => {
            const active = currentWorkspace?.id === ws.id;
            const editing = editingId === ws.id;
            return (
              <div
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-2.5",
                  active && "border-primary/50",
                )}
                key={ws.id}
              >
                {editing ? (
                  <>
                    <Input
                      autoFocus
                      className="flex-1"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitRename(ws);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <div className="flex flex-none items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        title="Save name"
                        onClick={() => submitRename(ws)}
                      >
                        <Save />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Cancel"
                        onClick={() => setEditingId(null)}
                      >
                        <X />
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="flex min-w-0 items-center gap-2">
                      <strong className="truncate text-sm font-semibold">
                        {ws.name}
                      </strong>
                      {active && (
                        <small className="text-xs text-primary">current</small>
                      )}
                    </span>
                    <div className="flex flex-none items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Rename"
                        onClick={() => startRename(ws)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Export workspace"
                        onClick={() => onExport(ws.id)}
                      >
                        <Upload />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Delete"
                        onClick={() => onDelete(ws.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {!workspaces.length && (
            <Empty className="m-auto">
              <EmptyMedia variant="icon">
                <FolderPlus />
              </EmptyMedia>
              <EmptyTitle>No workspaces yet</EmptyTitle>
            </Empty>
          )}
        </div>
      </Panel>
    </Page>
  );
}