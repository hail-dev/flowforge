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
import ConfigPanel from "./ConfigPanel";
import { toFlow, toDefinition, defaultNode, nextId, type FlowNode } from "./dsl";
import { listWorkflows, getWorkflow, saveDefinition, createWorkflow, ApiError, type WorkflowSummary } from "./api";
import type { WorkflowDefinition, WorkflowNode } from "../../api/src/dsl/schema";

const nodeTypes = { ff: FFNode };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Unexpected error");

export default function Canvas({ onLogout }: { onLogout: () => void }) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    listWorkflows()
      .then((list) => {
        setWorkflows(list);
        if (list.length > 0) setSelectedId(list[0].id);
        else setStatus("No workflows yet. Click New workflow.");
      })
      .catch((e) => setStatus(errMsg(e)));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setErrors([]);
    setSelectedNodeId(null);
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
          setStatus("This workflow has no valid definition yet. Add a trigger.");
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

  function addNode(type: WorkflowNode["type"]) {
    setNodes((ns) => {
      const id = nextId(type, ns);
      return [
        ...ns,
        {
          id,
          type: "ff",
          position: { x: 120 + ns.length * 30, y: 320 + ns.length * 20 },
          deletable: type !== "trigger",
          data: { dsl: defaultNode(type, id) },
        },
      ];
    });
  }

  function updateNode(id: string, dsl: WorkflowNode) {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { dsl } } : n)));
  }

  function deleteNode(id: string) {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelectedNodeId(null);
  }

  async function newWorkflow() {
    const name = window.prompt("Workflow name?");
    if (!name || !name.trim()) return;
    try {
      const wf = await createWorkflow(name.trim(), { nodes: [defaultNode("trigger", "trigger-1")], edges: [] });
      setWorkflows((prev) => [{ id: wf.id, name: wf.name, is_active: wf.is_active }, ...prev]);
      setSelectedId(wf.id);
    } catch (e) {
      setStatus(errMsg(e));
    }
  }

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

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const hasTrigger = nodes.some((n) => n.data.dsl.type === "trigger");

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
        <button onClick={newWorkflow}>New workflow</button>
        <span style={{ borderLeft: "1px solid #ddd", height: 20 }} />
        <button onClick={() => addNode("trigger")} disabled={!selectedId || hasTrigger}>
          + Trigger
        </button>
        <button onClick={() => addNode("condition")} disabled={!selectedId}>
          + Condition
        </button>
        <button onClick={() => addNode("action")} disabled={!selectedId}>
          + HTTP action
        </button>
        <span style={{ borderLeft: "1px solid #ddd", height: 20 }} />
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
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        {selectedNode && (
          <ConfigPanel
            key={selectedNode.id}
            node={selectedNode}
            onChange={(dsl) => updateNode(selectedNode.id, dsl)}
            onDelete={() => deleteNode(selectedNode.id)}
          />
        )}
      </div>
    </div>
  );
}