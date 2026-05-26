export function formatSchedule(
  schedule: { kind: string; value: string },
  expiresAt?: number,
  totalOccurrences?: number,
  ruleKind?: string,
): string {
  const base = formatScheduleBase(schedule, ruleKind);
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

function formatScheduleBase(schedule: { kind: string; value: string }, ruleKind?: string) {
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
  if (schedule.kind === "seconds") {
    const n = parseInt(schedule.value);
    if (ruleKind === "oneShot") {
      if (n >= 60) {
        const mins = Math.round(n / 60);
        return mins === 1 ? "After 1 minute" : `After ${mins} minutes`;
      }
      return n === 1 ? "After 1 second" : `After ${n} seconds`;
    }
    return n === 1 ? "Every second" : `Every ${n} seconds`;
  }
  if (schedule.kind === "yearly") {
    const pd = parseMonthDay(schedule.value);
    if (!pd) return `Yearly on ${schedule.value}`;
    const date = new Date(2000, pd.month - 1, pd.day);
    const monthName = date.toLocaleDateString("en-US", { month: "long" });
    return `Yearly on ${monthName} ${pd.day}${ordinalSuffix(String(pd.day))}`;
  }
  if (schedule.kind === "once") {
    const hasTime = schedule.value.includes("T");
    const d = new Date(hasTime ? schedule.value : schedule.value + "T00:00:00");
    if (!isNaN(d.getTime())) {
      const datePart = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      if (hasTime) {
        const h = d.getHours();
        const m = d.getMinutes();
        const ampm = h >= 12 ? "PM" : "AM";
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        const mStr = String(m).padStart(2, "0");
        return `On ${datePart} at ${h12}:${mStr} ${ampm}`;
      }
      return `On ${datePart}`;
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

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

function parseMonthDay(value: string): { month: number; day: number } | null {
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { month: m, day: d };
    const mName = MONTH_NAMES[parts[0].toLowerCase()];
    const d2 = parseInt(parts[1], 10);
    if (mName && d2 >= 1 && d2 <= 31) return { month: mName, day: d2 };
  }
  const spaceMatch = value.trim().match(/^([a-zA-Z]+)\s+(\d{1,2})$/);
  if (spaceMatch) {
    const m = MONTH_NAMES[spaceMatch[1].toLowerCase()];
    const d = parseInt(spaceMatch[2], 10);
    if (m && d >= 1 && d <= 31) return { month: m, day: d };
  }
  return null;
}

function ordinalSuffix(val: string): string {
  const n = parseInt(val);
  if (isNaN(n)) return "";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
