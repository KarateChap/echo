import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "tickScheduledRules",
  { seconds: 30 },
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

crons.interval(
  "syncAgentNonce",
  { minutes: 2 },
  internal.nonce.periodicSync,
);

export default crons;
