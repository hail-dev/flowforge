exports.up = (pgm) => {
    pgm.createTable("workflows", {
        id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
        tenant_id: {
            type: "uuid",
            notNull: true,
            references: "tenants",
            onDelete: "CASCADE",
        },
        name: { type: "text", notNull: true },
        definition: { type: "jsonb", notNull: true, default: "{}" },
        is_active: { type: "boolean", notNull: true, default: false},
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });

    pgm.createIndex("workflows", "tenant_id");
};

exports.down = (pgm) => {
    pgm.dropTable("workflows");
}