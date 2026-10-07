exports.up = (pgm) => {
pgm.createTable("executions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    workflow_id: { type: "uuid", notNull: true, references: "workflows", onDelete: "CASCADE" },
    status: {
    type: "text",
    notNull: true,
    default: "pending",
    check: "status IN ('pending', 'running', 'success', 'failure')",
    },
    trigger_payload: { type: "jsonb", notNull: true, default: "{}" },
    error: { type: "text" },
    started_at: { type: "timestamptz" },
    finished_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
});
pgm.createIndex("executions", "tenant_id");
pgm.createIndex("executions", "workflow_id");

pgm.createTable("execution_steps", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    execution_id: { type: "uuid", notNull: true, references: "executions", onDelete: "CASCADE" },
    node_id: { type: "text", notNull: true },
    node_type: { type: "text", notNull: true, check: "node_type IN ('trigger', 'condition', 'action')" },
    status: { type: "text", notNull: true, check: "status IN ('success', 'failure', 'skipped')" },
    output: { type: "jsonb" },
    error: { type: "text" },
    started_at: { type: "timestamptz", notNull: true },
    ended_at: { type: "timestamptz", notNull: true },
});
pgm.createIndex("execution_steps", "execution_id");
};

exports.down = (pgm) => {
pgm.dropTable("execution_steps");
pgm.dropTable("executions");
};