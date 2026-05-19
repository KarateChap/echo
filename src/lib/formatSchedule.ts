export function formatSchedule(
  schedule: { kind: string; value: string },
  expiresAt?: number,
  totalOccurrences?: number,
): string {
  const base = formatScheduleBase(schedule);
  if (totalOccurrences) {
    return `${base} (${totalOccurrences}x)`;
  }
  if (expiresAt) {
    const remainMs = expiresAt - Date.now();
    if (remainMs <= 0) return `${base} (expired)`;
    const mins = Math.ceil(remainMs / 60000);
    if (mins < 60) return `${base} for ${mins} min`;
    const hrs = Math.round(mins / 60);
    return `${base} for ${hrs} hr`;
  }
  return base;
}

function formatScheduleBase(schedule: { kind: string; value: string }) {
  if (schedule.kind === "monthly") {
    if (schedule.value === "last") return "Monthly on the last day";
    return `Monthly on the ${schedule.value}${ordinalSuffix(schedule.value)}`;
  }
  if (schedule.kind === "weekly") return `Weekly on ${schedule.value}`;
  if (schedule.kind === "daily") {
    const [h, m] = (schedule.value || "09:00").split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const mStr = m ? `:${String(m).padStart(2, "0")}` : "";
    return `Every day at ${h12}${mStr} ${ampm}`;
  }
  if (schedule.kind === "biweekly") return `Every other ${schedule.value}`;
  if (schedule.kind === "once") {
    const d = new Date(schedule.value + "T00:00:00");
    if (!isNaN(d.getTime())) {
      return `On ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
    }
    return `On ${schedule.value}`;
  }
  // Cron — try to make it human-readable
  const parts = schedule.value.trim().split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;
    const pieces: string[] = [];

    // Check for sub-daily step intervals first
    const minStep = min.match(/^\*\/(\d+)$/);
    const hourStep = hour.match(/^\*\/(\d+)$/);

    if (min === "*" && hour === "*") {
      pieces.push("Every minute");
    } else if (minStep) {
      const n = parseInt(minStep[1]);
      pieces.push(n === 1 ? "Every minute" : `Every ${n} minutes`);
    } else if (hourStep) {
      const n = parseInt(hourStep[1]);
      pieces.push(n === 1 ? "Every hour" : `Every ${n} hours`);
    } else if (hour === "*" && min !== "*") {
      pieces.push("Every hour");
    } else if (dow !== "*" && dow !== "?") {
      const dayNames: Record<string, string> = { "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday", "7": "Sunday" };
      const days = dow.split(",").map((d) => dayNames[d] ?? d).join(", ");
      pieces.push(`Every ${days}`);
    } else if (dom !== "*" && dom !== "?") {
      const days = dom.split(",").map((d) => `${d}${ordinalSuffix(d)}`).join(" and ");
      pieces.push(`On the ${days} of the month`);
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

function ordinalSuffix(val: string): string {
  const n = parseInt(val);
  if (isNaN(n)) return "";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
