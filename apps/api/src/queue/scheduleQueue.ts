import { Queue } from "bullmq";
import { env } from "../env";

export const SCHEDULE_QUEUE_NAME = "workflow-schedule";

export const scheduleQueue = new Queue(SCHEDULE_QUEUE_NAME, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: {
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
});