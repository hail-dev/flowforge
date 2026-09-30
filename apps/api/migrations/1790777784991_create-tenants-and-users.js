exports.up = (pgm) => {
    pgm.createExtension("pgcrypto", { ifNotExists: true });

    pgm.createTable("tenants", {
        id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
        name: { type: "text", notNull: true },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });

    pgm.createExtension("citext", { ifNotExists: true });

    pgm.createTable("users", {
        id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
        tenant_id: {
            type: "uuid",
            notNull: true,
            references: "tenants",
            onDelete: "CASCADE",
        },
        email: { type: "citext", notNull: true },
        password_hash: { type: "text", notNull: true },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    
    pgm.addConstraint("users", "users_email_unique", "UNIQUE(email)");
    pgm.createIndex("users", "tenant_id");
};

exports.down = (pgm) => {
    pgm.dropTable("users");
    pgm.dropTable("tenants");
};