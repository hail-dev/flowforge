import { Queue } from "bullmq";

export const EXECUTION_QUEUE_NAME = "workflow-execution";
export const SCHEDULE_QUEUE_NAME = "workflow-schedule";

export interface ExecutionJobData {
  executionId: string;
}

export function createExecutionQueue(redisUrl: string): Queue {
  return new Queue(EXECUTION_QUEUE_NAME, {
    connection: { url: redisUrl },
    defaultJobOptions: {
      removeOnComplete: { age: 3600 }, // keep completed jobs 1hr for debugging, then auto-clean
      removeOnFail: false, // keep failed jobs visible for inspection
    },
  });
}

export function createScheduleQueue(redisUrl: string): Queue {
  return new Queue(SCHEDULE_QUEUE_NAME, {
    connection: { url: redisUrl },
    defaultJobOptions: {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    },
  });
}