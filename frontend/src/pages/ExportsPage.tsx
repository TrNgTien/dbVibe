import React from "react";
import { Copy, ExternalLink, FileText, FolderOpen, Trash2 } from "lucide-react";
import { api } from "../utils/api";

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
    <section className="exportsPage">
      <section className="panel exportsPanel">
        <div className="panelHead">
          <div>
            <h2>Exports</h2>
            <small>Files saved from query results on this machine</small>
          </div>
          <div className="rowActions">
            <button onClick={onClear} disabled={!exports.length}>
              <Trash2 size={15} /> Clear
            </button>
          </div>
        </div>

        {exports.length ? (
          <div className="exportList">
            {exports.map((item) => (
              <div className="exportItem" key={item.id}>
                <div className="exportIcon">
                  <FileText size={18} />
                </div>
                <div className="exportMeta">
                  <strong>{item.name}</strong>
                  <span>{item.path}</span>
                  <small>
                    {item.format.toUpperCase()} · {item.rows} rows ·{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </small>
                </div>
                <div className="exportActions">
                  <button title="Open file" onClick={() => openFile(item.path)}>
                    <ExternalLink size={15} />
                  </button>
                  <button
                    title="Reveal in file manager"
                    onClick={() => revealFile(item.path)}
                  >
                    <FolderOpen size={15} />
                  </button>
                  <button title="Copy path" onClick={() => copyPath(item.path)}>
                    <Copy size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty exportsEmpty">
            <FileText size={28} />
            <p>No exported files yet</p>
          </div>
        )}
      </section>
    </section>
  );
}
