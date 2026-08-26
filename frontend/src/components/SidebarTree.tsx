import React from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  KeyRound,
  Table2,
  View,
  Activity,
  Pin,
  PinOff,
  Pencil,
  PowerOff,
  Copy,
  Trash2,
  Upload,
} from "lucide-react";
import { DriverLogo, StatusDot } from "./common";
import { driverLabel, normalizeObjectType } from "../utils/api";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const treeItemClasses =
  "flex min-h-[31px] w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

export function ConnectionContextMenu({
  menu,
  connected,
  workspaces,
  onCloseConnection,
  onEditConnection,
  onTogglePin,
  onMoveToWorkspace,
  onCopyConnectionString,
  onDeleteConnection,
}) {
  return (
    <div
      className="fixed z-50 w-[190px] max-w-[280px] min-w-max rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start px-2.5 py-1.5 font-normal"
        onClick={onCopyConnectionString}
      >
        <Copy data-icon="inline-start" className="size-3.5" /> Copy connection
        string
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start px-2.5 py-1.5 font-normal"
        onClick={onTogglePin}
      >
        {menu.conn.isPinned ? (
          <PinOff data-icon="inline-start" className="size-3.5" />
        ) : (
          <Pin data-icon="inline-start" className="size-3.5" />
        )}
        {menu.conn.isPinned ? "Unpin" : "Pin"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start px-2.5 py-1.5 font-normal"
        onClick={onEditConnection}
      >
        <Pencil data-icon="inline-start" className="size-3.5" /> Edit connection
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start px-2.5 py-1.5 font-normal"
        onClick={onCloseConnection}
        disabled={!connected}
      >
        <PowerOff data-icon="inline-start" className="size-3.5" /> Close
        connection
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start px-2.5 py-1.5 font-normal"
        onClick={onDeleteConnection}
      >
        <Trash2 data-icon="inline-start" className="size-3.5" /> Delete
        connection
      </Button>
      <div className="my-1 h-px bg-border" />
      <div className="px-2.5 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        Move to workspace
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start px-2.5 py-1.5 font-normal"
        onClick={() => onMoveToWorkspace(menu.conn, "")}
        disabled={!menu.conn.workspaceId}
      >
        {!menu.conn.workspaceId && (
          <Check className="w-[15px] flex-none text-primary" />
        )}
        Ungrouped
      </Button>
      {(workspaces || []).map((ws) => (
        <Button
          key={ws.id}
          variant="ghost"
          size="sm"
          className="w-full justify-start px-2.5 py-1.5 font-normal"
          onClick={() => onMoveToWorkspace(menu.conn, ws.id)}
          disabled={menu.conn.workspaceId === ws.id}
        >
          {menu.conn.workspaceId === ws.id && (
            <Check className="w-[15px] flex-none text-primary" />
          )}
          {ws.name}
        </Button>
      ))}
    </div>
  );
}

export function SidebarTree({
  groups,
  expandedWorkspaces,
  onToggleWorkspace,
  onExportWorkspace,
  onDeleteWorkspace,
  details,
  expandedConnections,
  expandedObjects,
  connectedConnections,
  selected,
  objectFilter,
  onSelectConnection,
  onToggleConnection,
  onToggleObject,
  onOpenDatabase,
  onOpenTable,
  onDeleteRedisKey,
  onNewQuery,
  onContextMenu,
  selectionMode,
  selectedConnIds,
  onToggleConnSelected,
}) {
  const filterTerm = (objectFilter || "").trim().toLowerCase();
  const matchesFilter = (item) =>
    !filterTerm || String(item?.name || "").toLowerCase().includes(filterTerm);

  const renderConnection = (conn) => {
    const isExpanded =
      expandedConnections[conn.id] ||
      (!!filterTerm && selected?.id === conn.id);
    const detail = details[conn.id];
    const isConnected = connectedConnections[conn.id];
    const isChecked = selectionMode && selectedConnIds.has(conn.id);

    const rawDatabases = detail?.databases?.length
      ? detail.databases
      : detail?.database
        ? [{ name: detail.database, size: 0 }]
        : [];
    const allObjects = (detail?.tables || []).map((table) => ({
      ...table,
      objectType: normalizeObjectType(table.type),
    }));
    const connIndexes = (detail?.indexes || []).filter(
      (index) =>
        !filterTerm ||
        String(index.name || "").toLowerCase().includes(filterTerm) ||
        String(index.table || "").toLowerCase().includes(filterTerm),
    );
    const tables = allObjects.filter(
      (table) =>
        table.objectType === "table" &&
        (matchesFilter(table) ||
          (!!filterTerm &&
            connIndexes.some(
              (index) =>
                String(index.table).toLowerCase() ===
                String(table.name).toLowerCase(),
            ))),
    );
    const views = (
      detail?.views ||
      allObjects.filter((table) => table.objectType === "view")
    ).filter(matchesFilter);
    const routines = detail?.routines || [];
    const functions = (
      detail?.functions ||
      routines.filter((routine) => routine.type === "function")
    ).filter(matchesFilter);
    const procedures = routines.filter(
      (routine) => routine.type === "procedure" && matchesFilter(routine),
    );

    return (
      <div key={conn.id} className={cn("flex flex-col", isChecked && "[&>div]:bg-accent")}>
        <div
          className={cn(
            "flex min-h-8 items-center rounded-md px-1",
            selected?.id === conn.id && "bg-accent",
          )}
          onContextMenu={(event) => onContextMenu(event, conn)}
        >
          {selectionMode && (
            <span
              className="flex size-4 flex-none cursor-pointer items-center justify-center"
              onClick={(e) => {
                e.stopPropagation();
                onToggleConnSelected(conn);
              }}
            >
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => onToggleConnSelected(conn)}
                aria-label={`Toggle select ${conn.name}`}
                className="size-4"
              />
            </span>
          )}
          <span
            className="flex size-6 flex-none cursor-pointer items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            role="button"
            tabIndex={0}
            aria-expanded={isExpanded}
            onClick={(e) => {
              if (!selectionMode) onToggleConnection(conn, e);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!selectionMode) onToggleConnection(conn, e);
              }
            }}
          >
            {isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </span>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center justify-start gap-2 text-left"
            onClick={() =>
              selectionMode
                ? onToggleConnSelected(conn)
                : onSelectConnection(conn)
            }
          >
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <StatusDot
                status={isConnected ? "connected" : "disconnected"}
              />
              <DriverLogo driver={conn.driver} size={16} />
              <span className="truncate">{conn.name}</span>
              {conn.isPinned && (
                <Pin
                  size={12}
                  fill="currentColor"
                  className="flex-none text-muted-foreground"
                />
              )}
            </span>
            <small className="ml-auto flex-none text-xs text-muted-foreground">
              {driverLabel(conn.driver)}
            </small>
          </button>
        </div>

        {isExpanded && (
          <div className="ml-3.5 flex flex-col border-l border-border pl-2">
            {(!detail || !isConnected) && (
              <div className="px-2 py-1.5 pl-8 text-xs text-muted-foreground">
                Loading...
              </div>
            )}
            {detail && isConnected && (
              <ConnectionTreeInner
                connId={conn.id}
                driver={conn.driver}
                forceExpand={!!filterTerm && selected?.id === conn.id}
                activeDatabase={detail.database}
                databases={rawDatabases}
                tables={tables}
                views={views}
                functions={functions}
                procedures={procedures}
                indexes={connIndexes}
                expanded={expandedObjects}
                onToggle={(key) => onToggleObject(conn.id, key)}
                onOpenDatabase={(db) => onOpenDatabase(db, conn.id)}
                onOpenTable={(table) => onOpenTable(table, conn.id)}
                onDeleteRedisKey={(key) => onDeleteRedisKey?.(key, conn.id)}
                onNewQuery={onNewQuery}
              />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-0.5 overflow-auto p-2.5">
      {groups.map((group) => {
        const expanded = group.isUngrouped
          ? true
          : !!expandedWorkspaces[group.id];
        return (
          <div key={group.id || "ungrouped"} className="flex flex-col">
            <div
              className={cn(
                "flex min-h-[30px] items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold text-foreground",
                !group.isUngrouped && "cursor-pointer hover:bg-muted",
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
                <span className="flex size-4 flex-none items-center justify-center text-muted-foreground" />
              ) : (
                <span className="flex size-4 flex-none items-center justify-center text-muted-foreground">
                  {expanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{group.name}</span>
              <small className="flex-none text-xs text-muted-foreground">
                {group.connections.length}
              </small>
              {!group.isUngrouped && (
                <span className="flex flex-none gap-0.5">
                  {group.connections.length > 0 && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-[22px]"
                      title="Export workspace"
                      onClick={(e) => {
                        e.stopPropagation();
                        onExportWorkspace(group.id);
                      }}
                    >
                      <Upload className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-[22px]"
                    title="Delete workspace"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteWorkspace(group.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              )}
            </div>
            {expanded && group.connections.map((conn) => renderConnection(conn))}
          </div>
        );
      })}
    </div>
  );
}

function IndexRow({ index, deep }) {
  const isPrimary = index.name === "PRIMARY" || /_pkey$/i.test(index.name);
  const columnCount = String(index.columns || "")
    .split(",")
    .filter((part) => part.trim()).length;
  const kind = isPrimary ? "primary" : index.unique ? "unique" : "index";
  return (
    <div
      className={cn(treeItemClasses, "cursor-default hover:bg-transparent")}
      title={`${kind}${columnCount > 1 ? ` · composite (${columnCount} columns)` : ""} on ${index.table} (${index.columns})`}
    >
      <div className="w-[15px] flex-none" />
      {deep && <div className="w-[15px] flex-none" />}
      <KeyRound
        size={14}
        className={cn(
          "flex-none",
          isPrimary ? "text-yellow-400" : index.unique ? "text-primary" : "",
        )}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-xs">
        {index.name}
        {index.columns && (
          <span className="text-muted-foreground"> ({index.columns})</span>
        )}
      </span>
      {isPrimary && (
        <Badge className="h-auto rounded px-[5px] py-[3px] text-[10px] font-bold leading-none border-yellow-500/30 bg-yellow-400/10 text-yellow-400">
          PK
        </Badge>
      )}
      {!isPrimary && index.unique && (
        <Badge className="h-auto rounded px-[5px] py-[3px] text-[10px] font-bold leading-none border-primary/30 bg-primary/10 text-primary">
          UQ
        </Badge>
      )}
      {columnCount > 1 && (
        <Badge
          variant="secondary"
          className="h-auto rounded px-[5px] py-[3px] text-[10px] font-bold leading-none"
        >
          {columnCount} cols
        </Badge>
      )}
    </div>
  );
}

function RedisKeyVirtualList({ keys, onOpenTable, onDeleteRedisKey }) {
  const parentRef = React.useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 31,
    overscan: 12,
  });
  return (
    <div
      ref={parentRef}
      className="max-h-[60vh] min-h-30 overflow-auto [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]"
    >
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const key = keys[vi.index];
          return (
            <div
              key={key.name}
              className={cn(
                treeItemClasses,
                "cursor-pointer",
              )}
              role="button"
              tabIndex={0}
              onClick={() => onOpenTable(key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenTable(key);
                }
              }}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${vi.size}px`,
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <div className="w-[15px] flex-none" />
              <Table2 size={14} className="flex-none" />
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs"
                title={key.name}
              >
                {key.name}
              </span>
              <small className="flex-none text-xs text-muted-foreground">
                {key.type}
              </small>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6 flex-none p-1 text-muted-foreground hover:text-foreground"
                title={`Delete ${key.name}`}
                aria-label={`Delete ${key.name}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDeleteRedisKey?.(key);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConnectionTreeInner({
  connId,
  driver,
  forceExpand,
  activeDatabase,
  databases,
  tables,
  views,
  functions,
  procedures,
  indexes,
  expanded,
  onToggle,
  onOpenDatabase,
  onOpenTable,
  onDeleteRedisKey,
  onNewQuery,
}) {
  const isOpen = (key) => expanded[`${connId}_${key}`] || forceExpand;
  const isRedis = driver === "redis";
  const isElasticsearch = driver === "elasticsearch";
  const isMongoDB = driver === "mongodb";

  if (isElasticsearch) {
    return null;
  }

  const branchButton = (label, count, icon, isOpenFlag, onClick) => (
    <Button
      variant="ghost"
      size="sm"
      className={cn(treeItemClasses, "min-w-0 gap-0")}
      onClick={onClick}
    >
      <span className="flex size-4 flex-none items-center justify-center text-muted-foreground">
        {isOpenFlag ? (
          <ChevronDown size={14} />
        ) : (
          <ChevronRight size={14} />
        )}
      </span>
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <small className="ml-auto flex-none text-xs text-muted-foreground">
        {count}
      </small>
    </Button>
  );

  if (isRedis) {
    return (
      <>
        <div className="flex flex-col">
          {branchButton(
            "Databases",
            databases.length,
            <Database size={14} className="flex-none" />,
            expanded[`${connId}_databases`],
            () => onToggle("databases"),
          )}
          {expanded[`${connId}_databases`] && (
            <div className="ml-3.5 flex flex-col border-l border-border pl-2">
              {databases.map((db) => {
                const name = typeof db === "string" ? db : db.name;
                const keyCount = typeof db === "string" ? 0 : db.size;
                return (
                  <Button
                    key={name}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      treeItemClasses,
                      "min-w-0",
                      activeDatabase === name && "bg-accent text-foreground",
                    )}
                    onClick={() => onOpenDatabase(name)}
                  >
                    <div className="w-[15px] flex-none" />
                    <Database size={14} className="flex-none" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      db{name}
                    </span>
                    <small className="ml-auto flex-none text-xs text-muted-foreground">
                      {keyCount} keys
                    </small>
                  </Button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex flex-col">
          {branchButton(
            "Keys",
            tables.length,
            <Table2 size={14} className="flex-none" />,
            isOpen("tables"),
            () => onToggle("tables"),
          )}
          {isOpen("tables") && (
            <div className="ml-3.5 flex flex-col border-l border-border pl-2">
              {tables.length === 0 && (
                <div className="px-2 py-1.5 pl-8 text-xs text-muted-foreground">
                  No keys found
                </div>
              )}
              {tables.length > 0 && (
                <RedisKeyVirtualList
                  keys={tables}
                  onOpenTable={onOpenTable}
                  onDeleteRedisKey={onDeleteRedisKey}
                />
              )}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {databases.length > 1 && (
        <div className="flex flex-col">
          {branchButton(
            "Databases",
            databases.length,
            <Database size={14} className="flex-none" />,
            expanded[`${connId}_databases`],
            () => onToggle("databases"),
          )}
          {expanded[`${connId}_databases`] && (
            <div className="ml-3.5 flex flex-col border-l border-border pl-2">
              {databases.map((db) => {
                const name = typeof db === "string" ? db : db.name;
                return (
                  <Button
                    key={name}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      treeItemClasses,
                      "min-w-0",
                      activeDatabase === name && "bg-accent text-foreground",
                    )}
                    onClick={() => onOpenDatabase(name)}
                  >
                    <div className="w-[15px] flex-none" />
                    <Database size={14} className="flex-none" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {name}
                    </span>
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col">
        {branchButton(
          isMongoDB ? "Collections" : "Tables",
          tables.length,
          <Table2 size={14} className="flex-none" />,
          isOpen("tables"),
          () => onToggle("tables"),
        )}
        {isOpen("tables") && (
          <div className="ml-3.5 flex flex-col border-l border-border pl-2">
            {tables.length === 0 && (
              <div className="px-2 py-1.5 pl-8 text-xs text-muted-foreground">
                {isMongoDB ? "No collections found" : "No tables found"}
              </div>
            )}
            {tables.map((table) => {
              const canExpandIndexes =
                driver === "postgres" ||
                driver === "timescaledb" ||
                driver === "mysql";
              const tableKey = `tableIdx_${table.schema}.${table.name}`;
              const tableIndexes = (indexes || []).filter(
                (index) =>
                  String(index.table).toLowerCase() ===
                  String(table.name).toLowerCase(),
              );
              return (
                <div
                  key={`${table.schema}.${table.name}`}
                  className="flex flex-col"
                >
                  <div className="flex items-center">
                    <div className="w-[15px] flex-none" />
                    {canExpandIndexes && (
                      <span
                        className="flex size-6 flex-none cursor-pointer items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        role="button"
                        tabIndex={0}
                        aria-expanded={isOpen(tableKey)}
                        title="Show indexes"
                        onClick={() => onToggle(tableKey)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onToggle(tableKey);
                          }
                        }}
                      >
                        {isOpen(tableKey) ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(treeItemClasses, "min-w-0 flex-1")}
                      onClick={() => onOpenTable(table)}
                    >
                      <Table2 size={14} className="flex-none" />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {table.name}
                      </span>
                      {table.schema && (
                        <small className="ml-auto max-w-[35%] flex-none truncate text-xs text-muted-foreground">
                          {table.schema}
                        </small>
                      )}
                    </Button>
                  </div>
                  {canExpandIndexes && isOpen(tableKey) && (
                    <div className="ml-3.5 flex flex-col border-l border-border pl-2">
                      {tableIndexes.length === 0 && (
                        <div className="px-2 py-1.5 pl-8 text-xs text-muted-foreground">
                          No indexes
                        </div>
                      )}
                      {tableIndexes.map((index) => (
                        <IndexRow
                          key={`${index.schema}.${index.table}.${index.name}`}
                          index={index}
                          deep
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col">
        {branchButton(
          "Views",
          views.length,
          <View size={14} className="flex-none" />,
          isOpen("views"),
          () => onToggle("views"),
        )}
        {isOpen("views") && (
          <div className="ml-3.5 flex flex-col border-l border-border pl-2">
            {views.length === 0 && (
              <div className="px-2 py-1.5 pl-8 text-xs text-muted-foreground">
                No views found
              </div>
            )}
            {views.map((view) => (
              <Button
                key={`${view.schema}.${view.name}`}
                variant="ghost"
                size="sm"
                className={cn(treeItemClasses, "min-w-0")}
                onClick={() => onOpenTable(view)}
              >
                <div className="w-[15px] flex-none" />
                <View size={14} className="flex-none" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {view.name}
                </span>
                {view.schema && (
                  <small className="ml-auto max-w-[35%] flex-none truncate text-xs text-muted-foreground">
                    {view.schema}
                  </small>
                )}
              </Button>
            ))}
          </div>
        )}
      </div>

      {(driver === "postgres" || driver === "timescaledb" || driver === "mysql") && (
        <>
          <div className="flex flex-col">
            {branchButton(
              "Functions",
              functions.length,
              <Activity size={14} className="flex-none" />,
              isOpen("functions"),
              () => onToggle("functions"),
            )}
            {isOpen("functions") && (
              <div className="ml-3.5 flex flex-col border-l border-border pl-2">
                {functions.length === 0 && (
                  <div className="px-2 py-1.5 pl-8 text-xs text-muted-foreground">
                    No functions found
                  </div>
                )}
                {functions.map((func) => (
                  <Button
                    key={`${func.schema}.${func.name}`}
                    variant="ghost"
                    size="sm"
                    className={cn(treeItemClasses, "min-w-0 cursor-default")}
                  >
                    <div className="w-[15px] flex-none" />
                    <Activity size={14} className="flex-none" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {func.name}
                    </span>
                    {func.schema && (
                      <small className="ml-auto max-w-[35%] flex-none truncate text-xs text-muted-foreground">
                        {func.schema}
                      </small>
                    )}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col">
            {branchButton(
              "Procedures",
              procedures.length,
              <Activity size={14} className="flex-none" />,
              isOpen("procedures"),
              () => onToggle("procedures"),
            )}
            {isOpen("procedures") && (
              <div className="ml-3.5 flex flex-col border-l border-border pl-2">
                {procedures.length === 0 && (
                  <div className="px-2 py-1.5 pl-8 text-xs text-muted-foreground">
                    No procedures found
                  </div>
                )}
                {procedures.map((proc) => (
                  <Button
                    key={`${proc.schema}.${proc.name}`}
                    variant="ghost"
                    size="sm"
                    className={cn(treeItemClasses, "min-w-0 cursor-default")}
                  >
                    <div className="w-[15px] flex-none" />
                    <Activity size={14} className="flex-none" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {proc.name}
                    </span>
                    {proc.schema && (
                      <small className="ml-auto max-w-[35%] flex-none truncate text-xs text-muted-foreground">
                        {proc.schema}
                      </small>
                    )}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}