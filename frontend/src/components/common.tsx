import React from "react";
import {
  MySQLIcon,
  PostgreSQLIcon,
  TimescaleDBIcon,
  RedisIcon,
  ElasticsearchIcon,
  MongoDBIcon,
} from "../icons";
import { connectionLabel, driverLabel } from "../utils/api";
import { cn } from "@/lib/utils";

const statusDotColors = {
  disconnected: "bg-muted-foreground/50 ring-muted-foreground/15",
  connecting: "bg-yellow-400 ring-yellow-400/20",
  connected: "bg-emerald-400 ring-emerald-400/20",
  error: "bg-red-400 ring-red-400/20",
};

export function StatusDot({ status }) {
  const color =
    statusDotColors[status] || statusDotColors.disconnected;
  return (
    <span
      className={cn(
        "size-2 flex-none rounded-full ring-2",
        color,
      )}
      title={connectionLabel(status)}
    />
  );
}

export function DriverLogo({ driver, size = 22, className = "" }) {
  const props = {
    className: cn("flex-none", className),
    width: size,
    height: size,
  };
  switch (driver) {
    case "postgres":
      return <PostgreSQLIcon {...props} />;
    case "timescaledb":
      return <TimescaleDBIcon {...props} />;
    case "redis":
      return <RedisIcon {...props} />;
    case "elasticsearch":
      return <ElasticsearchIcon {...props} />;
    case "mongodb":
      return <MongoDBIcon {...props} />;
    case "mysql":
    default:
      return <MySQLIcon {...props} />;
  }
}

export function ConnectionStatus({ status, driver }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 font-medium text-muted-foreground">
      <StatusDot status={status} />
      {status === "connected" ? driverLabel(driver) : connectionLabel(status)}
    </span>
  );
}
