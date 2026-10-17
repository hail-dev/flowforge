import { pool } from "../db";
import { scheduleQueue } from "../queue/scheduleQueue";
import { apiLog } from "../logger";

export const schedulerIdFor = (workflowId: string) => `wf:${workflowId}`;

export function getCronExpression(definition: any): string | null {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const trigger = nodes.find((n: any) => n.type === "trigger");
  return trigger?.config?.kind === "cron" ? trigger.config.expression : null;
}

export async function syncSchedule(wf: {
  id: string;
  is_active: boolean;
  definition: unknown;
}) {
  const expression = wf.is_active ? getCronExpression(wf.definition) : null;
  if (expression) {
    await scheduleQueue.upsertJobScheduler(
      schedulerIdFor(wf.id),
      { pattern: expression, tz: "UTC" },
      { name: "tick", data: { workflowId: wf.id } },
    );
  } else {
    await scheduleQueue.removeJobScheduler(schedulerIdFor(wf.id));
  }
}

export async function removeSchedule(workflowId: string) {
  await scheduleQueue.removeJobScheduler(schedulerIdFor(workflowId));
}

// Rebuilds Redis schedulers from Postgres. Returns how many cron schedules are live.
export async function reconcileSchedules(): Promise<number> {
  const result = await pool.query<{
    id: string;
    is_active: boolean;
    definition: unknown;
  }>("SELECT id, is_active, definition FROM workflows WHERE is_active = true");
  let scheduled = 0;
  for (const wf of result.rows) {
    try {
      await syncSchedule(wf);
      if (getCronExpression(wf.definition)) scheduled++;
    } catch (err) {
      apiLog.error({ err, workflowId: wf.id }, "could not sync schedule");
    }
  }
  return scheduled;
}
