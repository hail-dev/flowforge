import { Queue } from "bullmq";
import { env } from "../env";

export const EXECUTION_QUEUE_NAME = "workflow-execution";

export const executionQueue = new Queue(EXECUTION_QUEUE_NAME, {
    connection: { url: env.REDIS_URL },
    defaultJobOptions: {
        removeOnComplete: { age: 3600 }, //keep completed jobs 1hr for debugging, then auto-clean
        removeOnFail: false, // keep failed jobs visible for inspection (dead-letter inspection)
    },
});

export interface ExecutionJobData {
    executionId: string;
}