exports.up = (pgm) => {
    pgm.addColumn("executions", { idempotency_key: { type: "text" } });
    pgm.addConstraint("executions", "executions_workflow_idempotency_unique", {
        unique: ["workflow_id", "idempotency_key"],
    });
};

exports.down = (pgm) => {
    pgm.dropConstraint("executions", "executions_workflow_idempotency_unique");
    pgm.dropColumn("executions", "idempotency_key");
};