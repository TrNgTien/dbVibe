import React from "react";
import { Trash2 } from "lucide-react";

export function SavedQueries({ queries, onOpen, onDelete }) {
  return (
    <div className="savedQueries">
      <h3>Stored Query</h3>
      {queries.map((query) => (
        <div key={query.id} style={{ display: 'flex', gap: '6px' }}>
          <button style={{ flex: 1, overflow: 'hidden' }} onClick={() => onOpen(query)}>
            <span>{query.name}</span>
            <small>{new Date(query.updatedAt).toLocaleString()}</small>
          </button>
          <button 
            className="iconButton" 
            style={{ flex: '0 0 auto', padding: '0 8px', border: '1px solid #333a44', background: '#1c2128', borderRadius: '6px' }} 
            onClick={() => onDelete(query.id)} 
            title="Delete query"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}