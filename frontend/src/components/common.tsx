import React from "react";
import { MySQLIcon, PostgreSQLIcon, TimescaleDBIcon, RedisIcon, ElasticsearchIcon, MongoDBIcon } from "../icons";
import { connectionLabel, driverLabel } from "../utils/api";

export function StatusDot({ status }) {
  return <span className={`statusDot ${status}`} title={connectionLabel(status)} />;
}

export function DriverLogo({ driver }) {
  switch (driver) {
    case "postgres":
      return <PostgreSQLIcon className="driverLogo" />;
    case "timescaledb":
      return <TimescaleDBIcon className="driverLogo" />;
    case "redis":
      return <RedisIcon className="driverLogo" />;
    case "elasticsearch":
      return <ElasticsearchIcon className="driverLogo" />;
    case "mongodb":
      return <MongoDBIcon className="driverLogo" />;
    case "mysql":
    default:
      return <MySQLIcon className="driverLogo" />;
  }
}

export function ConnectionStatus({ status, driver }) {
  return (
    <span className="connectionStatus">
      <StatusDot status={status} />
      {status === "connected" ? driverLabel(driver) : connectionLabel(status)}
    </span>
  );
}
