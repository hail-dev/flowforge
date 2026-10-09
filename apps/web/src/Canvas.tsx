  import { useCallback } from "react";
  import {
    ReactFlow,
    Background,
    Controls,
    addEdge,
    useNodesState,
    useEdgesState,
    type Connection,
    type Edge,
    type Node,
  } from "@xyflow/react";
  import "@xyflow/react/dist/style.css";

  const initialNodes: Node[] = [
    { id: "trigger-1", position: { x: 0, y: 100 }, data: { label: "Trigger (webhook)" } },
    { id: "cond-1", position: { x: 250, y: 100 }, data: { label: "Condition: amount > 100" } },
    { id: "action-1", position: { x: 520, y: 100 }, data: { label: "HTTP request" } },
  ];

  const initialEdges: Edge[] = [
    { id: "e1", source: "trigger-1", target: "cond-1" },
    { id: "e2", source: "cond-1", target: "action-1" },
  ];

  export default function Canvas() {
    const [nodes, , onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    const onConnect = useCallback(
      (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
      [setEdges]
    );

    return (
      <div style={{ width: "100vw", height: "100vh" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    );
  }