import { createScheduleQueue, SCHEDULE_QUEUE_NAME } from "@flowforge/core";
import { env } from "../env";

export { SCHEDULE_QUEUE_NAME };
export const scheduleQueue = createScheduleQueue(env.REDIS_URL);