export function formatSchedule(schedule: { kind: string; value: string }) {
  if (schedule.kind === "monthly") return `Monthly on the ${schedule.value}`;
  if (schedule.kind === "weekly") return `Weekly on ${schedule.value}`;
  // Cron — try to make it human-readable
  const parts = schedule.value.trim().split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;
    const pieces: string[] = [];

    // Check for sub-daily step intervals first
    const minStep = min.match(/^\*\/(\d+)$/);
    const hourStep = hour.match(/^\*\/(\d+)$/);

    if (minStep) {
      const n = parseInt(minStep[1]);
      pieces.push(n === 1 ? "Every minute" : `Every ${n} minutes`);
    } else if (hourStep) {
      const n = parseInt(hourStep[1]);
      pieces.push(n === 1 ? "Every hour" : `Every ${n} hours`);
    } else if (dow !== "*" && dow !== "?") {
      const dayNames: Record<string, string> = { "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday", "7": "Sunday" };
      const days = dow.split(",").map((d) => dayNames[d] ?? d).join(", ");
      pieces.push(`Every ${days}`);
    } else if (dom !== "*" && dom !== "?") {
      pieces.push(`On day ${dom} of the month`);
    } else {
      pieces.push("Every day");
    }

    if (!minStep && !hourStep && hour !== "*") {
      const h = parseInt(hour);
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const m = min === "0" || min === "00" ? "" : `:${min.padStart(2, "0")}`;
      pieces.push(`at ${h12}${m} ${ampm}`);
    }
    if (mon !== "*") pieces.push(`in month ${mon}`);
    return pieces.join(" ");
  }
  return `Custom (${schedule.value})`;
}
