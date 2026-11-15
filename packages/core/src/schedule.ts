export const schedulerIdFor = (workflowId: string) => `wf:${workflowId}`;

// Returns the cron expression if the workflow's trigger is a cron trigger, otherwise null.
export function getCronExpression(definition: any): string | null {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const trigger = nodes.find((n: any) => n.type === "trigger");
  return trigger?.config?.kind === "cron" ? trigger.config.expression : null;
}