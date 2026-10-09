import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import FFNode from "./FFNode";
import { toFlow, toDefinition, type FlowNode } from "./dsl";
import { listWorkflows, getWorkflow, saveDefinition, ApiError, type WorkflowSummary } from "./api";
import type { WorkflowDefinition } from "../../api/src/dsl/schema";

const nodeTypes = { ff: FFNode };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Unexpected error");

export default function Canvas({ onLogout }: { onLogout: () => void }) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    listWorkflows()
      .then((list) => {
        setWorkflows(list);
        if (list.length > 0) setSelectedId(list[0].id);
        else setStatus("No workflows yet. Create one with the API first.");
      })
      .catch((e) => setStatus(errMsg(e)));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setErrors([]);
    setStatus("Loading...");
    getWorkflow(selectedId)
      .then((wf) => {
        if (cancelled) return;
        const def = wf.definition as Partial<WorkflowDefinition> | null;
        if (def && Array.isArray(def.nodes) && Array.isArray(def.edges)) {
          const flow = toFlow(def as WorkflowDefinition);
          setNodes(flow.nodes);
          setEdges(flow.edges);
          setStatus("Loaded");
        } else {
          setNodes([]);
          setEdges([]);
          setStatus("This workflow has no valid definition yet");
        }
      })
      .catch((e) => !cancelled && setStatus(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [selectedId, setNodes, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  async function save() {
    if (!selectedId) return;
    setErrors([]);
    setStatus("Saving...");
    try {
      await saveDefinition(selectedId, toDefinition(nodes, edges));
      setStatus("Saved");
    } catch (e) {
      setStatus("Save failed");
      if (e instanceof ApiError) setErrors(e.details.length > 0 ? e.details : [e.message]);
      else setErrors([errMsg(e)]);
    }
  }

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, borderBottom: "1px solid #ddd" }}>
        <strong>FlowForge</strong>
        <select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button onClick={save} disabled={!selectedId}>
          Save
        </button>
        <span style={{ color: "#555" }}>{status}</span>
        <button onClick={onLogout} style={{ marginLeft: "auto" }}>
          Log out
        </button>
      </div>
      {errors.length > 0 && (
        <ul style={{ margin: 0, padding: "8px 24px", background: "#fee2e2", color: "#991b1b" }}>
          {errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}