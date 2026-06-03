import React from "react";
import { Trash2 } from "lucide-react";

function queryField(query, camelName, goName) {
  return query?.[camelName] ?? query?.[goName] ?? "";
}

export function SavedQueries({
  queries,
  deletingQueryIds = new Set(),
  onOpen,
  onDelete,
}) {
  return (
    <div className="savedQueries">
      <h3>Stored Query</h3>
      {queries.map((query) => {
        const id = queryField(query, "id", "ID");
        const name = queryField(query, "name", "Name");
        const updatedAt = queryField(query, "updatedAt", "UpdatedAt");
        const isDeleting = deletingQueryIds.has(id);
        return (
          <div key={id} style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              style={{ flex: 1, overflow: "hidden" }}
              onClick={() => onOpen(query)}
              disabled={isDeleting}
            >
              <span>{name}</span>
              <small>
                {updatedAt ? new Date(updatedAt).toLocaleString() : ""}
              </small>
            </button>
            <button
              type="button"
              className="iconButton"
              style={{
                flex: "0 0 auto",
                padding: "0 8px",
                border: "1px solid #333a44",
                background: "#1c2128",
                borderRadius: "6px",
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDelete(query);
              }}
              disabled={isDeleting}
              title="Delete query"
              aria-label={`Delete ${name || "query"}`}
            >
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
