import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "tickScheduledRules",
  { minutes: 1 },
  internal.scheduler.tickScheduledRules,
);

crons.interval(
  "retryPendingNotifications",
  { minutes: 5 },
  internal.notify.retryPendingNotifications,
);

crons.interval(
  "tickConditionalRules",
  { minutes: 5 },
  internal.scheduler.tickConditionalRules,
);

export default crons;
