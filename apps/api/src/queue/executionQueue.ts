import { createExecutionQueue, EXECUTION_QUEUE_NAME, type ExecutionJobData } from "@flowforge/core";
import { env } from "../env";

export { EXECUTION_QUEUE_NAME };
export type { ExecutionJobData };
export const executionQueue = createExecutionQueue(env.REDIS_URL);