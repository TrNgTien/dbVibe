import React from "react";
import {
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
      className="contextMenu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button onClick={onCopyConnectionString}>
        <Copy size={15} /> Copy connection string
      </button>
      <button onClick={onTogglePin}>
        {menu.conn.isPinned ? <PinOff size={15} /> : <Pin size={15} />}
        {menu.conn.isPinned ? "Unpin" : "Pin"}
      </button>
      <button onClick={onEditConnection}>
        <Pencil size={15} /> Edit connection
      </button>
      <button onClick={onCloseConnection} disabled={!connected}>
        <PowerOff size={15} /> Close connection
      </button>
      <button onClick={onDeleteConnection}>
        <Trash2 size={15} /> Delete connection
      </button>
      <div className="contextMenuDivider" />
      <div className="contextMenuLabel">Move to workspace</div>
      <button
        onClick={() => onMoveToWorkspace(menu.conn, "")}
        disabled={!menu.conn.workspaceId}
      >
        {menu.conn.workspaceId ? "" : <span className="moveCheck">✓</span>}
        Ungrouped
      </button>
      {(workspaces || []).map((ws) => (
        <button
          key={ws.id}
          onClick={() => onMoveToWorkspace(menu.conn, ws.id)}
          disabled={menu.conn.workspaceId === ws.id}
        >
          {menu.conn.workspaceId === ws.id ? (
            <span className="moveCheck">✓</span>
          ) : null}
          {ws.name}
        </button>
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
      <div key={conn.id} className="treeBranch">
        <div
          className={`treeItem connectionItem ${selected?.id === conn.id ? "active" : ""}`}
          onContextMenu={(event) => onContextMenu(event, conn)}
        >
          <span
            className="treeChevron connectionChevron"
            role="button"
            tabIndex={0}
            aria-expanded={isExpanded}
            onClick={(e) => onToggleConnection(conn, e)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggleConnection(conn, e);
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
            className="connectionSelect"
            onClick={() => onSelectConnection(conn)}
          >
            <span className="connectionName">
              <StatusDot
                status={isConnected ? "connected" : "disconnected"}
              />
              <DriverLogo driver={conn.driver} />
              {conn.name}
              {conn.isPinned && (
                <Pin size={12} fill="currentColor" className="pinIcon" />
              )}
            </span>
            <small>{driverLabel(conn.driver)}</small>
          </button>
        </div>

        {isExpanded && (
          <div className="treeChildren connectionChildren">
            {(!detail || !isConnected) && (
              <div className="treeEmpty">Loading...</div>
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
    <div className="objectTree sidebarTree">
      {groups.map((group) => {
        const expanded = group.isUngrouped
          ? true
          : !!expandedWorkspaces[group.id];
        return (
          <div
            key={group.id || "ungrouped"}
            className="treeBranch workspaceGroup"
          >
            <div
              className="workspaceHeader"
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
                <span className="treeChevron" />
              ) : (
                <span className="treeChevron">
                  {expanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </span>
              )}
              <span className="workspaceName">{group.name}</span>
              <small>{group.connections.length}</small>
              {!group.isUngrouped && (
                <span className="workspaceActions">
                  {group.connections.length > 0 && (
                    <button
                      className="iconButton"
                      title="Export workspace"
                      onClick={(e) => {
                        e.stopPropagation();
                        onExportWorkspace(group.id);
                      }}
                    >
                      <Upload size={13} />
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
                    <Trash2 size={13} />
                  </button>
                </span>
              )}
            </div>
            {expanded &&
              group.connections.map((conn) => renderConnection(conn))}
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
      className="treeItem indexItem"
      title={`${kind}${columnCount > 1 ? ` · composite (${columnCount} columns)` : ""} on ${index.table} (${index.columns})`}
    >
      <div className="treeIndent" />
      {deep && <div className="treeIndent" />}
      <KeyRound size={14} className={`indexIcon ${kind}`} />
      <span className="treeKeyLabel">
        {index.name}
        {index.columns && (
          <span className="indexColumns"> ({index.columns})</span>
        )}
      </span>
      {isPrimary && <span className="indexBadge pk">PK</span>}
      {!isPrimary && index.unique && <span className="indexBadge uq">UQ</span>}
      {columnCount > 1 && (
        <span className="indexBadge cols">{columnCount} cols</span>
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
    <div ref={parentRef} className="redisVirtualList">
      <div
        className="redisVirtualListInner"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const key = keys[vi.index];
          return (
            <div
              key={key.name}
              className="treeItem redisKeyItem"
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
              <div className="treeIndent" />
              <Table2 size={14} />
              <span className="treeKeyLabel" title={key.name}>
                {key.name}
              </span>
              <small>{key.type}</small>
              <button
                type="button"
                className="iconButton treeRowAction"
                title={`Delete ${key.name}`}
                aria-label={`Delete ${key.name}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDeleteRedisKey?.(key);
                }}
              >
                <Trash2 size={14} />
              </button>
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

  if (isRedis) {
    return (
      <>
        <div className="treeBranch">
          <button className="treeItem" onClick={() => onToggle("databases")}>
            <div className="treeChevron">
              {expanded[`${connId}_databases`] ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </div>
            <Database size={14} />
            <span>Databases</span>
            <small>{databases.length}</small>
          </button>
          {expanded[`${connId}_databases`] && (
            <div className="treeChildren">
              {databases.map((db) => {
                const name = typeof db === "string" ? db : db.name;
                const keyCount = typeof db === "string" ? 0 : db.size;
                return (
                  <button
                    key={name}
                    className={`treeItem ${activeDatabase === name ? "active" : ""}`}
                    onClick={() => onOpenDatabase(name)}
                  >
                    <div className="treeIndent" />
                    <Database size={14} />
                    <span>db{name}</span>
                    <small>{keyCount} keys</small>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="treeBranch">
          <button className="treeItem" onClick={() => onToggle("tables")}>
            <div className="treeChevron">
              {isOpen("tables") ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </div>
            <Table2 size={14} />
            <span>Keys</span>
            <small>{tables.length}</small>
          </button>
          {isOpen("tables") && (
            <div className="treeChildren">
              {tables.length === 0 && (
                <div className="treeEmpty">No keys found</div>
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
        <div className="treeBranch">
          <button className="treeItem" onClick={() => onToggle("databases")}>
            <div className="treeChevron">
              {expanded[`${connId}_databases`] ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </div>
            <Database size={14} />
            <span>Databases</span>
            <small>{databases.length}</small>
          </button>
          {expanded[`${connId}_databases`] && (
            <div className="treeChildren">
              {databases.map((db) => {
                const name = typeof db === "string" ? db : db.name;
                return (
                  <button
                    key={name}
                    className={`treeItem ${activeDatabase === name ? "active" : ""}`}
                    onClick={() => onOpenDatabase(name)}
                  >
                    <div className="treeIndent" />
                    <Database size={14} />
                    <span>{name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="treeBranch">
        <button className="treeItem" onClick={() => onToggle("tables")}>
          <div className="treeChevron">
            {isOpen("tables") ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </div>
          <Table2 size={14} />
          <span>{isMongoDB ? "Collections" : "Tables"}</span>
          <small>{tables.length}</small>
        </button>
        {isOpen("tables") && (
          <div className="treeChildren">
            {tables.length === 0 && (
              <div className="treeEmpty">
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
                <div key={`${table.schema}.${table.name}`} className="treeBranch">
                  <div className="tableRow">
                    <div className="treeIndent" />
                    {canExpandIndexes && (
                      <span
                        className="treeChevron"
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
                    <button
                      className="treeItem"
                      onClick={() => onOpenTable(table)}
                    >
                      <Table2 size={14} />
                      <span>{table.name}</span>
                      {table.schema && <small>{table.schema}</small>}
                    </button>
                  </div>
                  {canExpandIndexes && isOpen(tableKey) && (
                    <div className="treeChildren">
                      {tableIndexes.length === 0 && (
                        <div className="treeEmpty">No indexes</div>
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

      <div className="treeBranch">
        <button className="treeItem" onClick={() => onToggle("views")}>
          <div className="treeChevron">
            {isOpen("views") ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </div>
          <View size={14} />
          <span>Views</span>
          <small>{views.length}</small>
        </button>
        {isOpen("views") && (
          <div className="treeChildren">
            {views.length === 0 && (
              <div className="treeEmpty">No views found</div>
            )}
            {views.map((view) => (
              <button
                key={`${view.schema}.${view.name}`}
                className="treeItem"
                onClick={() => onOpenTable(view)}
              >
                <div className="treeIndent" />
                <View size={14} />
                <span>{view.name}</span>
                {view.schema && <small>{view.schema}</small>}
              </button>
            ))}
          </div>
        )}
      </div>

      {(driver === "postgres" || driver === "timescaledb" || driver === "mysql") && (
        <>
          <div className="treeBranch">
            <button className="treeItem" onClick={() => onToggle("functions")}>
              <div className="treeChevron">
                {isOpen("functions") ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </div>
              <Activity size={14} />
              <span>Functions</span>
              <small>{functions.length}</small>
            </button>
            {isOpen("functions") && (
              <div className="treeChildren">
                {functions.length === 0 && (
                  <div className="treeEmpty">No functions found</div>
                )}
                {functions.map((func) => (
                  <button
                    key={`${func.schema}.${func.name}`}
                    className="treeItem"
                  >
                    <div className="treeIndent" />
                    <Activity size={14} />
                    <span>{func.name}</span>
                    {func.schema && <small>{func.schema}</small>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="treeBranch">
            <button className="treeItem" onClick={() => onToggle("procedures")}>
              <div className="treeChevron">
                {isOpen("procedures") ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </div>
              <Activity size={14} />
              <span>Procedures</span>
              <small>{procedures.length}</small>
            </button>
            {isOpen("procedures") && (
              <div className="treeChildren">
                {procedures.length === 0 && (
                  <div className="treeEmpty">No procedures found</div>
                )}
                {procedures.map((proc) => (
                  <button
                    key={`${proc.schema}.${proc.name}`}
                    className="treeItem"
                  >
                    <div className="treeIndent" />
                    <Activity size={14} />
                    <span>{proc.name}</span>
                    {proc.schema && <small>{proc.schema}</small>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
