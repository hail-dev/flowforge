import { CronExpressionParser } from "cron-parser";

// Returns an error message, or null if the expression is acceptable.
export function checkCron(expression: string): string | null {
  if (expression.trim().split(/\s+/).length !== 5) {
    return "Cron expression must have exactly 5 fields (minute hour day-of-month month weekday)";
  }
  try {
    CronExpressionParser.parse(expression, { tz: "UTC" });
    return null;
  } catch {
    return `Invalid cron expression: ${expression}`;
  }
}