import { useState, type ReactNode } from "react";
import type { FlowNode } from "./dsl";
import type { WorkflowNode } from "../../api/src/dsl/schema";

type TriggerNode = Extract<WorkflowNode, { type: "trigger" }>;
type ConditionNode = Extract<WorkflowNode, { type: "condition" }>;
type ActionNode = Extract<WorkflowNode, { type: "action" }>;
type OnChange = (n: WorkflowNode) => void;

const OPERATORS = ["equals", "not_equals", "greater_than", "less_than", "contains"] as const;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 2, fontSize: 12 }}>
      {label}
      {children}
    </label>
  );
}

// "100" -> 100, "true" -> true, anything else stays a string
function parseValue(text: string): string | number | boolean {
  if (text === "true") return true;
  if (text === "false") return false;
  if (text.trim() !== "" && !Number.isNaN(Number(text))) return Number(text);
  return text;
}

function TriggerForm({ node, onChange }: { node: TriggerNode; onChange: OnChange }) {
  const c = node.config;
  return (
    <>
      <Field label="Kind">
        <select
          value={c.kind}
          onChange={(e) =>
            onChange({
              ...node,
              config: e.target.value === "cron" ? { kind: "cron", expression: "*/5 * * * *" } : { kind: "webhook" },
            })
          }
        >
          <option value="webhook">webhook</option>
          <option value="cron">cron</option>
        </select>
      </Field>
      {c.kind === "cron" && (
        <Field label="Cron expression">
          <input
            value={c.expression}
            onChange={(e) => onChange({ ...node, config: { kind: "cron", expression: e.target.value } })}
          />
        </Field>
      )}
    </>
  );
}

function ConditionForm({ node, onChange }: { node: ConditionNode; onChange: OnChange }) {
  const c = node.config;
  const [valueText, setValueText] = useState(String(c.value));
  return (
    <>
      <Field label="Payload field (dot path)">
        <input value={c.field} onChange={(e) => onChange({ ...node, config: { ...c, field: e.target.value } })} />
      </Field>
      <Field label="Operator">
        <select
          value={c.operator}
          onChange={(e) => onChange({ ...node, config: { ...c, operator: e.target.value as (typeof OPERATORS)[number] } })}
        >
          {OPERATORS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Value">
        <input
          value={valueText}
          onChange={(e) => {
            setValueText(e.target.value);
            onChange({ ...node, config: { ...c, value: parseValue(e.target.value) } });
          }}
        />
      </Field>
    </>
  );
}

function ActionForm({ node, onChange }: { node: ActionNode; onChange: OnChange }) {
  const c = node.config;
  const set = (patch: Partial<typeof c>) => onChange({ ...node, config: { ...c, ...patch } });
  return (
    <>
      <Field label="URL">
        <input value={c.url} onChange={(e) => set({ url: e.target.value })} />
      </Field>
      <Field label="Method">
        <select value={c.method} onChange={(e) => set({ method: e.target.value as (typeof METHODS)[number] })}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Timeout (ms)">
        <input type="number" value={c.timeoutMs} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} />
      </Field>
      <Field label="Max attempts (1-5)">
        <input
          type="number"
          value={c.retry.maxAttempts}
          onChange={(e) => set({ retry: { ...c.retry, maxAttempts: Number(e.target.value) } })}
        />
      </Field>
      <Field label="Backoff (ms)">
        <input
          type="number"
          value={c.retry.backoffMs}
          onChange={(e) => set({ retry: { ...c.retry, backoffMs: Number(e.target.value) } })}
        />
      </Field>
      <small style={{ color: "#666" }}>Body: forwards the trigger payload.</small>
    </>
  );
}

export default function ConfigPanel({
  node,
  onChange,
  onDelete,
}: {
  node: FlowNode;
  onChange: OnChange;
  onDelete: () => void;
}) {
  const n = node.data.dsl;
  return (
    <div style={{ width: 280, padding: 12, borderLeft: "1px solid #ddd", display: "grid", gap: 10, alignContent: "start", overflowY: "auto" }}>
      <div>
        <strong style={{ textTransform: "uppercase", fontSize: 11 }}>{n.type}</strong>
        <div style={{ fontFamily: "monospace" }}>{n.id}</div>
      </div>
      {n.type === "trigger" && <TriggerForm node={n} onChange={onChange} />}
      {n.type === "condition" && <ConditionForm node={n} onChange={onChange} />}
      {n.type === "action" && <ActionForm node={n} onChange={onChange} />}
      {n.type !== "trigger" && (
        <button onClick={onDelete} style={{ color: "crimson" }}>
          Delete node
        </button>
      )}
    </div>
  );
}