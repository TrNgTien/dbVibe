import React from "react";
import { Copy, ExternalLink, FileText, FolderOpen, Trash2 } from "lucide-react";
import { api } from "../utils/api";
import { Page, Panel, PanelHeader } from "../components/shared/layout";
import { Button } from "@/components/ui/button";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function ExportsPage({ exports, onClear }) {
  const copyPath = async (path) => {
    await navigator.clipboard?.writeText(path);
  };

  const openFile = async (path) => {
    await api.call("OpenExportedFile", path);
  };

  const revealFile = async (path) => {
    await api.call("RevealExportedFile", path);
  };

  return (
    <Page>
      <Panel>
        <PanelHeader
          title="Exports"
          description="Files saved from query results on this machine"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={onClear}
              disabled={!exports.length}
            >
              <Trash2 data-icon="inline-start" /> Clear
            </Button>
          }
        />

        {exports.length ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2.5">
            {exports.map((item) => (
              <div
                className="grid min-h-[70px] grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2"
                key={item.id}
              >
                <div className="grid size-[34px] place-items-center rounded-md border border-border bg-muted text-primary">
                  <FileText className="size-4" />
                </div>
                <div className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-sm font-semibold">
                    {item.name}
                  </strong>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {item.path}
                  </span>
                  <small className="truncate text-xs text-muted-foreground">
                    {item.format.toUpperCase()} · {item.rows} rows ·{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </small>
                </div>
                <div className="flex flex-none gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Open file"
                    onClick={() => openFile(item.path)}
                  >
                    <ExternalLink />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Reveal in file manager"
                    onClick={() => revealFile(item.path)}
                  >
                    <FolderOpen />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Copy path"
                    onClick={() => copyPath(item.path)}
                  >
                    <Copy />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty className="flex-1">
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>No exported files yet</EmptyTitle>
          </Empty>
        )}
      </Panel>
    </Page>
  );
}