import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "./dsl";

const colors = { trigger: "#2563eb", condition: "#d97706", action: "#16a34a" } as const;

function summary(n: FlowNode["data"]["dsl"]): string {
  switch (n.type) {
    case "trigger":
      return n.config.kind === "cron" ? `cron: ${n.config.expression}` : "webhook";
    case "condition":
      return `${n.config.field} ${n.config.operator} ${String(n.config.value)}`;
    case "action":
      return `${n.config.method} ${n.config.url}`;
  }
}

export default function FFNode({ data }: NodeProps<FlowNode>) {
  const n = data.dsl;
  return (
    <div
      style={{
        position: "relative",
        border: `2px solid ${colors[n.type]}`,
        borderRadius: 8,
        background: "#fff",
        padding: "8px 28px 8px 12px",
        minWidth: 170,
        maxWidth: 240,
        fontSize: 12,
      }}
    >
      {n.type !== "trigger" && <Handle type="target" position={Position.Left} />}
      <div style={{ fontWeight: 700, color: colors[n.type], textTransform: "uppercase", fontSize: 10 }}>
        {n.type}
      </div>
      <div style={{ fontWeight: 600 }}>{n.id}</div>
      <div style={{ color: "#555", wordBreak: "break-all" }}>{summary(n)}</div>
      {n.type === "condition" ? (
        <>
          <Handle type="source" id="true" position={Position.Right} style={{ top: "30%" }} />
          <Handle type="source" id="false" position={Position.Right} style={{ top: "70%" }} />
          <span style={{ position: "absolute", right: 12, top: "18%", fontSize: 9 }}>true</span>
          <span style={{ position: "absolute", right: 12, top: "58%", fontSize: 9 }}>false</span>
        </>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}