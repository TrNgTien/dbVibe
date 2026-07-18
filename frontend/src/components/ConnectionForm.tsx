import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { DriverLogo } from "./common";
import { defaultPort } from "../utils/api";

export function ConnectionForm({ draft, setDraft }) {
  const [showPassword, setShowPassword] = useState(false);
  const connectionInputProps = {
    autoCapitalize: "none",
    autoCorrect: "off",
    spellCheck: false,
  };

  function patch(value) {
    const next = { ...draft, ...value };
    if (value.driver && !draft.id) next.port = defaultPort(value.driver);
    setDraft(next);
  }
  return (
    <div className="form">
      <label style={{ gridColumn: "span 2" }}>
        Name
        <input
          {...connectionInputProps}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>
      <label style={{ gridColumn: "span 2" }}>
        Driver
        <div className="driverGrid">
          {[
            { id: "mysql", name: "MySQL" },
            { id: "postgres", name: "PostgreSQL" },
            { id: "timescaledb", name: "TimescaleDB" },
            { id: "redis", name: "Redis" },
            { id: "elasticsearch", name: "Elasticsearch" },
            { id: "mongodb", name: "MongoDB" },
          ].map((d) => (
            <button
              key={d.id}
              type="button"
              className={`driverOption ${draft.driver === d.id ? "active" : ""}`}
              onClick={() => patch({ driver: d.id })}
            >
              <DriverLogo driver={d.id} />
              <span>{d.name}</span>
            </button>
          ))}
        </div>
      </label>
      <label>
        Host
        <input
          {...connectionInputProps}
          value={draft.host}
          onChange={(e) => patch({ host: e.target.value })}
        />
      </label>
      <label>
        Port
        <input
          {...connectionInputProps}
          type="number"
          value={draft.port}
          onChange={(e) => patch({ port: Number(e.target.value) })}
        />
      </label>
      {draft.driver === "mysql" && (
        <>
          <div className="formSection">
            <strong>Binlog endpoint</strong>
            <span>Optional direct MySQL server used when Host is ProxySQL.</span>
          </div>
          <label>
            Binlog host
            <input
              {...connectionInputProps}
              placeholder={draft.host || "Same as Host"}
              value={draft.binlogHost || ""}
              onChange={(e) => patch({ binlogHost: e.target.value })}
            />
          </label>
          <label>
            Binlog port
            <input
              {...connectionInputProps}
              type="number"
              placeholder={String(draft.port || 3306)}
              value={draft.binlogPort || ""}
              onChange={(e) => patch({ binlogPort: Number(e.target.value) })}
            />
          </label>
        </>
      )}
      <label>
        {draft.driver === "redis" ? "Database index" : "Database"}
        <input
          {...connectionInputProps}
          value={draft.database}
          onChange={(e) => patch({ database: e.target.value })}
        />
      </label>
      <label>
        User
        <input
          {...connectionInputProps}
          value={draft.user}
          onChange={(e) => patch({ user: e.target.value })}
        />
      </label>
      <label>
        Password
        <div className="passwordInput">
          <input
            {...connectionInputProps}
            type={showPassword ? "text" : "password"}
            value={draft.password || ""}
            onChange={(e) => patch({ password: e.target.value })}
          />
          <button
            type="button"
            className="iconButton"
            onClick={() => setShowPassword(!showPassword)}
            title={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </label>
      {draft.driver === "postgres" || draft.driver === "timescaledb" ? (
        <label>
          SSL mode
          <select
            value={draft.sslMode || "disable"}
            onChange={(e) => patch({ sslMode: e.target.value })}
          >
            <option>disable</option>
            <option>require</option>
            <option>verify-ca</option>
            <option>verify-full</option>
          </select>
        </label>
      ) : (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!draft.useTLS}
            onChange={(e) => patch({ useTLS: e.target.checked })}
          />{" "}
          {draft.driver === "elasticsearch" ? "HTTPS" : "TLS"}
        </label>
      )}
    </div>
  );
}
