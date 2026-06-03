import React from "react";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  Table2,
  View,
  Activity,
  Pin,
  PinOff,
  Pencil,
  PowerOff,
  Terminal,
  Trash2,
} from "lucide-react";
import { DriverLogo, StatusDot } from "./common";
import { driverLabel, normalizeObjectType } from "../utils/api";

export function ConnectionContextMenu({
  menu,
  connected,
  onCloseConnection,
  onEditConnection,
  onOpenTerminal,
  onTogglePin,
}) {
  return (
    <div
      className="contextMenu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button onClick={onTogglePin}>
        {menu.conn.isPinned ? <PinOff size={15} /> : <Pin size={15} />}
        {menu.conn.isPinned ? "Unpin" : "Pin"}
      </button>
      <button onClick={onEditConnection}>
        <Pencil size={15} /> Edit connection
      </button>
      <button onClick={onOpenTerminal}>
        <Terminal size={15} /> Open terminal
      </button>
      <button onClick={onCloseConnection} disabled={!connected}>
        <PowerOff size={15} /> Close connection
      </button>
    </div>
  );
}

export function SidebarTree({
  connections,
  details,
  expandedConnections,
  expandedObjects,
  connectedConnections,
  selected,
  onSelectConnection,
  onToggleConnection,
  onToggleObject,
  onOpenDatabase,
  onOpenTable,
  onDeleteRedisKey,
  onNewQuery,
  onContextMenu,
}) {
  return (
    <div className="objectTree sidebarTree">
      {connections.map((conn) => {
        const isExpanded = expandedConnections[conn.id];
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
        const tables = allObjects.filter(
          (table) => table.objectType === "table",
        );
        const views =
          detail?.views ||
          allObjects.filter((table) => table.objectType === "view");
        const routines = detail?.routines || [];
        const functions =
          detail?.functions ||
          routines.filter((routine) => routine.type === "function");
        const procedures = routines.filter(
          (routine) => routine.type === "procedure",
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
                    activeDatabase={detail.database}
                    databases={rawDatabases}
                    tables={tables}
                    views={views}
                    functions={functions}
                    procedures={procedures}
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
      })}
    </div>
  );
}

function ConnectionTreeInner({
  connId,
  driver,
  activeDatabase,
  databases,
  tables,
  views,
  functions,
  procedures,
  expanded,
  onToggle,
  onOpenDatabase,
  onOpenTable,
  onDeleteRedisKey,
  onNewQuery,
}) {
  const isRedis = driver === "redis";
  const isElasticsearch = driver === "elasticsearch";

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
              {expanded[`${connId}_tables`] ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </div>
            <Table2 size={14} />
            <span>Keys</span>
            <small>{tables.length}</small>
          </button>
          {expanded[`${connId}_tables`] && (
            <div className="treeChildren">
              {tables.length === 0 && (
                <div className="treeEmpty">No keys found</div>
              )}
              {tables.map((key) => (
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
              ))}
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
            {expanded[`${connId}_tables`] ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </div>
          <Table2 size={14} />
          <span>Tables</span>
          <small>{tables.length}</small>
        </button>
        {expanded[`${connId}_tables`] && (
          <div className="treeChildren">
            {tables.length === 0 && (
              <div className="treeEmpty">No tables found</div>
            )}
            {tables.map((table) => (
              <button
                key={`${table.schema}.${table.name}`}
                className="treeItem"
                onClick={() => onOpenTable(table)}
              >
                <div className="treeIndent" />
                <Table2 size={14} />
                <span>{table.name}</span>
                {table.schema && <small>{table.schema}</small>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="treeBranch">
        <button className="treeItem" onClick={() => onToggle("views")}>
          <div className="treeChevron">
            {expanded[`${connId}_views`] ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </div>
          <View size={14} />
          <span>Views</span>
          <small>{views.length}</small>
        </button>
        {expanded[`${connId}_views`] && (
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

      {(driver === "postgres" || driver === "mysql") && (
        <>
          <div className="treeBranch">
            <button className="treeItem" onClick={() => onToggle("functions")}>
              <div className="treeChevron">
                {expanded[`${connId}_functions`] ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </div>
              <Activity size={14} />
              <span>Functions</span>
              <small>{functions.length}</small>
            </button>
            {expanded[`${connId}_functions`] && (
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
                {expanded[`${connId}_procedures`] ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </div>
              <Activity size={14} />
              <span>Procedures</span>
              <small>{procedures.length}</small>
            </button>
            {expanded[`${connId}_procedures`] && (
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
