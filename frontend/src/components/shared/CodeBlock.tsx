import React from "react";
import { cn } from "@/lib/utils";

export function CodeBlock({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      <pre
        className={cn(
          "overflow-x-auto p-2.5 font-mono text-xs leading-relaxed text-foreground",
          className,
        )}
      >
        {children}
      </pre>
    </div>
  );
}