import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { DriverLogo } from "./common";
import { defaultPort } from "../utils/api";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const drivers = [
  { id: "mysql", name: "MySQL" },
  { id: "postgres", name: "PostgreSQL" },
  { id: "timescaledb", name: "TimescaleDB" },
  { id: "redis", name: "Redis" },
  { id: "elasticsearch", name: "Elasticsearch" },
  { id: "mongodb", name: "MongoDB" },
];

export function ConnectionForm({ draft, setDraft, workspaces }) {
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
    <FieldGroup className="grid grid-cols-2 gap-2.5 p-3">
      <Field className="col-span-2">
        <FieldLabel>Name</FieldLabel>
        <Input
          {...connectionInputProps}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </Field>
      <Field className="col-span-2">
        <FieldLabel>Workspace</FieldLabel>
        <NativeSelect
          value={draft.workspaceId || ""}
          onChange={(e) => patch({ workspaceId: e.target.value })}
        >
          <option value="">Ungrouped</option>
          {(workspaces || []).map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field className="col-span-2">
        <FieldLabel>Driver</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={8}
          className="grid w-full grid-cols-3"
          value={draft.driver}
          onValueChange={(value) => value && patch({ driver: value })}
        >
          {drivers.map((d) => (
            <ToggleGroupItem
              key={d.id}
              value={d.id}
              className="h-auto w-full flex-col justify-center gap-1 p-4"
              title={d.name}
            >
              <DriverLogo driver={d.id} size={40} className="size-10" />
              <span className="text-[10px] leading-none font-normal">{d.name}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <Field>
        <FieldLabel>Host</FieldLabel>
        <Input
          {...connectionInputProps}
          value={draft.host}
          onChange={(e) => patch({ host: e.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel>Port</FieldLabel>
        <Input
          {...connectionInputProps}
          type="number"
          value={draft.port}
          onChange={(e) => patch({ port: Number(e.target.value) })}
        />
      </Field>
      {draft.driver === "mysql" && (
        <>
          <div className="col-span-2 grid gap-0.5 pt-1 text-xs text-foreground">
            <strong className="font-semibold">Binlog endpoint</strong>
            <span className="text-muted-foreground">
              Optional direct MySQL server used when Host is ProxySQL.
            </span>
          </div>
          <Field>
            <FieldLabel>Binlog host</FieldLabel>
            <Input
              {...connectionInputProps}
              placeholder={draft.host || "Same as Host"}
              value={draft.binlogHost || ""}
              onChange={(e) => patch({ binlogHost: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel>Binlog port</FieldLabel>
            <Input
              {...connectionInputProps}
              type="number"
              placeholder={String(draft.port || 3306)}
              value={draft.binlogPort || ""}
              onChange={(e) => patch({ binlogPort: Number(e.target.value) })}
            />
          </Field>
        </>
      )}
      <Field>
        <FieldLabel>{draft.driver === "redis" ? "Database index" : "Database"}</FieldLabel>
        <Input
          {...connectionInputProps}
          value={draft.database}
          onChange={(e) => patch({ database: e.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel>User</FieldLabel>
        <Input
          {...connectionInputProps}
          value={draft.user}
          onChange={(e) => patch({ user: e.target.value })}
        />
      </Field>
      <Field className="col-span-2">
        <FieldLabel>Password</FieldLabel>
        <InputGroup>
          <InputGroupInput
            {...connectionInputProps}
            type={showPassword ? "text" : "password"}
            value={draft.password || ""}
            onChange={(e) => patch({ password: e.target.value })}
          />
          <InputGroupButton
            type="button"
            size="icon-sm"
            onClick={() => setShowPassword(!showPassword)}
            title={showPassword ? "Hide password" : "Show password"}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff /> : <Eye />}
          </InputGroupButton>
        </InputGroup>
      </Field>
      {draft.driver === "postgres" || draft.driver === "timescaledb" ? (
        <Field className="col-span-2">
          <FieldLabel>SSL mode</FieldLabel>
          <NativeSelect
            value={draft.sslMode || "disable"}
            onChange={(e) => patch({ sslMode: e.target.value })}
          >
            <option>disable</option>
            <option>require</option>
            <option>verify-ca</option>
            <option>verify-full</option>
          </NativeSelect>
        </Field>
      ) : (
        <Field orientation="horizontal" className="col-span-2 items-center gap-2">
          <Checkbox
            id="conn-use-tls"
            checked={!!draft.useTLS}
            onCheckedChange={(checked) => patch({ useTLS: !!checked })}
          />
          <FieldLabel htmlFor="conn-use-tls">
            {draft.driver === "elasticsearch" ? "HTTPS" : "TLS"}
          </FieldLabel>
        </Field>
      )}
    </FieldGroup>
  );
}