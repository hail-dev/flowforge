exports.up = (pgm) => {
  pgm.addColumn("workflows", {
    webhook_secret: {
      type: "text",
      notNull: true,
      default: pgm.func("encode(gen_random_bytes(24), 'hex')"),
    },
  });
  pgm.addConstraint("workflows", "workflows_webhook_secret_unique", { unique: ["webhook_secret"] });
};

exports.down = (pgm) => {
  pgm.dropConstraint("workflows", "workflows_webhook_secret_unique");
  pgm.dropColumn("workflows", "webhook_secret");
};