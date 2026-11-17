import {
  createExecutionQueue,
  createScheduleQueue,
  enqueueExecution as enqueueWithDeps,
  type EnqueueInput,
  type EnqueueResult,
} from "@flowforge/core";
import { pool } from "./db";
import { env } from "./env";

export const executionQueue = createExecutionQueue(env.REDIS_URL);
export const scheduleQueue = createScheduleQueue(env.REDIS_URL);

export const enqueueExecution = (input: EnqueueInput): Promise<EnqueueResult> =>
  enqueueWithDeps({ pool, queue: executionQueue }, input);