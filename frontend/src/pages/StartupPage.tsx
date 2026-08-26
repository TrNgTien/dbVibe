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
} from "lucide-react";
import { DriverLogo, StatusDot } from "../components/common";
import { isLocalConnection } from "../utils/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    <div className="grid min-h-screen grid-cols-[360px_minmax(0,1fr)] bg-background">
      <aside className="flex flex-col items-center justify-center gap-3.5 border-r border-border bg-muted/40 px-[26px] py-[42px]">
        <div className="flex size-[116px] items-center justify-center rounded-[26px] bg-amber-400 text-amber-50 shadow-2xl shadow-black/40">
          <Database size={76} />
        </div>
        <h1 className="mt-3 text-2xl font-bold text-foreground">dbVibe</h1>
        <p className="max-w-60 text-center text-sm text-muted-foreground">
          MySQL / PostgreSQL / TimescaleDB / Redis / Elasticsearch / MongoDB
        </p>
        <Button
          className="mt-7 h-11 w-full max-w-72 text-base"
          onClick={onCreate}
        >
          <Plus data-icon="inline-start" />
          Create Connection
        </Button>
      </aside>

      <main className="flex min-w-0 flex-col">
        <div className="flex min-h-[76px] items-center gap-3 border-b border-border px-[18px] py-3.5">
          <Button variant="outline" size="icon-lg" className="size-11" title="Create connection" onClick={onCreate}>
            <Plus />
          </Button>
          <Button variant="outline" size="icon-lg" className="size-11" title="New workspace" onClick={onCreateWorkspace}>
            <FolderPlus />
          </Button>
          <Button variant="outline" size="icon-lg" className="size-11" title="Import workspace" onClick={onImportWorkspace}>
            <Download />
          </Button>
          <label className="ml-auto flex min-h-[38px] w-[min(440px,50vw)] items-center gap-[9px] rounded-lg border border-border bg-background px-2.5 focus-within:border-ring">
            <Search className="size-4 flex-none text-muted-foreground" />
            <input
              className="h-8 w-full min-w-0 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground"
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

        <div className="flex flex-col gap-1.5 overflow-auto p-[22px]">
          {groups.map((group) => {
            const expanded = group.isUngrouped
              ? true
              : !!expandedWorkspaces[group.id];
            return (
              <div key={group.id || "ungrouped"} className="flex flex-col gap-1">
                <div
                  className={cn(
                    "flex min-h-[34px] items-center gap-2 rounded-lg px-2 text-sm",
                    group.isUngrouped
                      ? "text-muted-foreground/70"
                      : "cursor-pointer text-foreground hover:bg-muted",
                  )}
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
                    <span className="flex size-4 flex-none items-center justify-center" />
                  ) : (
                    <span className="flex size-4 flex-none items-center justify-center text-muted-foreground">
                      {expanded ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                    </span>
                  )}
                  <strong className="text-[15px] font-semibold">{group.name}</strong>
                  <small className="ml-1 text-xs text-muted-foreground">
                    {group.connections.length}
                  </small>
                  {!group.isUngrouped && (
                    <span className="ml-auto flex flex-none gap-1">
                      {group.connections.length > 0 && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-[30px]"
                          title="Export workspace"
                          onClick={(e) => {
                            e.stopPropagation();
                            onExportWorkspace(group.id);
                          }}
                        >
                          <Upload />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-[30px]"
                        title="Delete workspace"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteWorkspace(group.id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  )}
                </div>
                {expanded &&
                  group.connections.map((conn) => (
                    <Button
                      key={conn.id}
                      variant="ghost"
                      className="min-h-[62px] w-full justify-start gap-3.5 rounded-lg px-3 py-2 text-left"
                      onClick={() => onSelect(conn)}
                    >
                      <DriverLogo driver={conn.driver} size={22} />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <strong className="text-base font-semibold">
                          {conn.name}
                        </strong>
                        <small className="text-sm text-muted-foreground">
                          {conn.host}:{conn.port}
                          {conn.database ? `/${conn.database}` : ""}
                        </small>
                      </span>
                      {isLocalConnection(conn) && (
                        <span className="flex flex-none items-center gap-1.5 text-xs text-muted-foreground">
                          <StatusDot status="connected" /> local
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={cn(
                          "flex-none",
                          !isLocalConnection(conn) && "ml-auto",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePin(conn);
                        }}
                        title={conn.isPinned ? "Unpin" : "Pin"}
                        aria-label={conn.isPinned ? "Unpin" : "Pin"}
                      >
                        <Pin fill={conn.isPinned ? "currentColor" : "none"} />
                      </Button>
                    </Button>
                  ))}
              </div>
            );
          })}
          {!groups.some((g) => g.connections.length) && (
            <div className="flex min-h-56 flex-col items-center justify-center gap-2.5 text-muted-foreground">
              <Database className="size-7" />
              <span className="text-sm">No connections found</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}