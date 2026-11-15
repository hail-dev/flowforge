import { enqueueExecution as enqueueWithDeps, type EnqueueInput, type EnqueueResult } from "@flowforge/core";
import { pool } from "../db";
import { executionQueue } from "../queue/executionQueue";

export type { EnqueueInput, EnqueueResult };

export const enqueueExecution = (input: EnqueueInput): Promise<EnqueueResult> =>
  enqueueWithDeps({ pool, queue: executionQueue }, input);