import { useEffect, useState } from "react";
import {
  listExecutions,
  getExecution,
  listWorkflows,
  type ExecutionDetail,
  type ExecutionStatus,
  type ExecutionSummary,
  type WorkflowSummary,
} from "./api";

const PAGE_SIZE = 20;
const MAX_JSON_CHARS = 3000;

const statusColors: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "#f3f4f6", fg: "#374151" },
  running: { bg: "#dbeafe", fg: "#1d4ed8" },
  success: { bg: "#dcfce7", fg: "#166534" },
  failure: { bg: "#fee2e2", fg: "#991b1b" },
  skipped: { bg: "#f3f4f6", fg: "#6b7280" },
};

const cell = { padding: "6px 8px", verticalAlign: "top" } as const;
const preStyle = {
  background: "#f6f8fa",
  padding: 8,
  borderRadius: 4,
  fontSize: 11,
  overflowX: "auto",
  margin: "4px 0 0",
} as const;
const errorBox = { background: "#fee2e2", color: "#991b1b", padding: 8, borderRadius: 4, fontSize: 12 } as const;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Unexpected error");
const isActive = (s: string) => s === "pending" || s === "running";

function Badge({ status }: { status: string }) {
  const c = statusColors[status] ?? statusColors.pending;
  return (
    <span style={{ background: c.bg, color: c.fg, padding: "1px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
      {status}
    </span>
  );
}

function fmtDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

function fmtTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function pretty(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? "";
  return text.length > MAX_JSON_CHARS
    ? `${text.slice(0, MAX_JSON_CHARS)}\n... (truncated, ${text.length} characters total)`
    : text;
}

function DetailView({ detail }: { detail: ExecutionDetail }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <strong>{detail.workflow_name}</strong>
          <Badge status={detail.status} />
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#666" }}>{detail.id}</div>
      </div>

      <div style={{ fontSize: 12, color: "#444", display: "grid", gap: 2 }}>
        <span>Created: {fmtTime(detail.created_at)}</span>
        <span>Started: {fmtTime(detail.started_at)}</span>
        <span>Finished: {fmtTime(detail.finished_at)}</span>
        <span>Duration: {fmtDuration(detail.duration_ms)}</span>
        {detail.idempotency_key && (
          <span>
            Idempotency key: <code>{detail.idempotency_key}</code>
          </span>
        )}
      </div>

      {detail.error && (
        <div style={errorBox}>
          <strong>Error:</strong> {detail.error}
        </div>
      )}

      <details>
        <summary style={{ cursor: "pointer", fontSize: 12 }}>Trigger payload</summary>
        <pre style={preStyle}>{pretty(detail.trigger_payload)}</pre>
      </details>

      <div>
        <strong style={{ fontSize: 12 }}>Steps ({detail.steps.length})</strong>
        {detail.steps.length === 0 && (
          <p style={{ fontSize: 12, color: "#777" }}>
            {isActive(detail.status)
              ? "No steps yet. Steps are recorded when the run finishes."
              : "No steps were recorded for this run."}
          </p>
        )}
        {detail.steps.map((s, i) => {
          const out = s.output && typeof s.output === "object" ? (s.output as Record<string, unknown>) : null;
          const statusCode = s.node_type === "action" && out && "statusCode" in out ? String(out.statusCode) : null;
          const attempts = s.node_type === "action" && out && "attempts" in out ? String(out.attempts) : null;
          const accent = s.status === "failure" ? "#dc2626" : s.status === "success" ? "#16a34a" : "#9ca3af";
          return (
            <div
              key={`${i}-${s.node_id}`}
              style={{
                border: "1px solid #e5e7eb",
                borderLeft: `4px solid ${accent}`,
                borderRadius: 4,
                padding: 8,
                marginTop: 6,
                fontSize: 12,
              }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ color: "#888" }}>{i + 1}</span>
                <strong>{s.node_id}</strong>
                <span style={{ color: "#777" }}>{s.node_type}</span>
                <Badge status={s.status} />
                <span style={{ marginLeft: "auto", color: "#555" }}>{fmtDuration(s.duration_ms)}</span>
              </div>
              {(statusCode || attempts) && (
                <div style={{ color: "#555", marginTop: 4 }}>
                  {statusCode && `HTTP ${statusCode}`}
                  {statusCode && attempts && " · "}
                  {attempts && `${attempts} attempt(s)`}
                </div>
              )}
              {s.error && <div style={{ color: "#991b1b", marginTop: 4 }}>{s.error}</div>}
              {s.output !== null && s.output !== undefined && (
                <details open={s.status === "failure"} style={{ marginTop: 4 }}>
                  <summary style={{ cursor: "pointer" }}>Output</summary>
                  <pre style={preStyle}>{pretty(s.output)}</pre>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function History({ onBack, onLogout }: { onBack: () => void; onLogout: () => void }) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [status, setStatus] = useState<"" | ExecutionStatus>("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<ExecutionSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    listWorkflows().then(setWorkflows).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    listExecutions({ workflowId: workflowId || undefined, status: status || undefined, limit: PAGE_SIZE, offset })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setListError(null);
      })
      .catch((e) => {
        if (!cancelled) setListError(errMsg(e));
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId, status, offset, tick]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    getExecution(selectedId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setDetailError(null);
      })
      .catch((e) => {
        if (!cancelled) setDetailError(errMsg(e));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, tick]);

  const hasActive =
    (items ?? []).some((i) => isActive(i.status)) || (detail !== null && isActive(detail.status));

  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(timer);
  }, [hasActive]);

  function selectExecution(id: string) {
    setSelectedId(id);
    setDetailError(null);
  }

  const hasFilters = workflowId !== "" || status !== "";

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, borderBottom: "1px solid #ddd" }}>
        <button onClick={onBack}>← Builder</button>
        <strong>Execution history</strong>
        <select
          value={workflowId}
          onChange={(e) => {
            setWorkflowId(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All workflows</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "" | ExecutionStatus);
            setOffset(0);
          }}
        >
          <option value="">All statuses</option>
          {(["pending", "running", "success", "failure"] as const).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button onClick={() => setTick((n) => n + 1)}>Refresh</button>
        {hasActive && <span style={{ color: "#555", fontSize: 12 }}>auto-refreshing...</span>}
        <button onClick={onLogout} style={{ marginLeft: "auto" }}>
          Log out
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 12 }}>
          {listError && <div style={{ ...errorBox, marginBottom: 8 }}>Could not load executions: {listError}</div>}
          {items === null && !listError && <p>Loading...</p>}
          {items !== null && items.length === 0 && (
            <p style={{ color: "#777" }}>
              {hasFilters
                ? "No executions match these filters."
                : "No executions yet. Trigger a workflow and its runs will show up here."}
            </p>
          )}
          {items !== null && items.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#555" }}>
                  <th style={cell}>Status</th>
                  <th style={cell}>Workflow</th>
                  <th style={cell}>Created</th>
                  <th style={cell}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr
                    key={it.id}
                    onClick={() => selectExecution(it.id)}
                    style={{
                      cursor: "pointer",
                      background: it.id === selectedId ? "#eff6ff" : undefined,
                      borderTop: "1px solid #eee",
                    }}
                  >
                    <td style={cell}>
                      <Badge status={it.status} />
                    </td>
                    <td style={cell}>
                      {it.workflow_name}
                      {it.error && <div style={{ color: "#991b1b", fontSize: 11 }}>{it.error}</div>}
                    </td>
                    <td style={cell}>{fmtTime(it.created_at)}</td>
                    <td style={cell}>{fmtDuration(it.duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {items !== null && (offset > 0 || items.length === PAGE_SIZE) && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 12 }}>
              <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>
                Previous
              </button>
              <span>
                {items.length > 0 ? `Showing ${offset + 1}-${offset + items.length}` : "No results on this page"}
              </span>
              <button onClick={() => setOffset(offset + PAGE_SIZE)} disabled={items.length < PAGE_SIZE}>
                Next
              </button>
            </div>
          )}
        </div>

        <div style={{ width: 460, borderLeft: "1px solid #ddd", overflowY: "auto", padding: 12 }}>
          {!selectedId && <p style={{ color: "#777" }}>Select an execution to see its steps.</p>}
          {selectedId && detailError && <div style={errorBox}>Could not load execution: {detailError}</div>}
          {selectedId && !detailError && (!detail || detail.id !== selectedId) && <p>Loading...</p>}
          {selectedId && detail && detail.id === selectedId && <DetailView detail={detail} />}
        </div>
      </div>
    </div>
  );
}