import React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      <h3 className="mb-0.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Stored Query
      </h3>
      {queries.map((query) => {
        const id = queryField(query, "id", "ID");
        const name = queryField(query, "name", "Name");
        const updatedAt = queryField(query, "updatedAt", "UpdatedAt");
        const isDeleting = deletingQueryIds.has(id);
        return (
          <div key={id} className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              className="min-w-0 flex-1 justify-start overflow-hidden px-2.5 font-normal"
              onClick={() => onOpen(query)}
              disabled={isDeleting}
            >
              <span className="min-w-0 flex-1 truncate text-left">{name}</span>
              <span className="flex-none text-xs text-muted-foreground">
                {updatedAt ? new Date(updatedAt).toLocaleString() : ""}
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDelete(query);
              }}
              disabled={isDeleting}
              title="Delete query"
              aria-label={`Delete ${name || "query"}`}
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
