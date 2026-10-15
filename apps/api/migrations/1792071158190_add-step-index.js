exports.up = (pgm) => {
  pgm.addColumn("execution_steps", { step_index: { type: "integer" } });
};

exports.down = (pgm) => {
  pgm.dropColumn("execution_steps", "step_index");
};