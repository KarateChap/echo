const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

/**
 * Parse a date value into month/day numbers.
 * Handles: "02-01", "2-1", "February 1", "Feb 1", "February-1"
 */
export function parseMonthDay(value: string): { month: number; day: number } | null {
  if (!value) return null;

  const parts = value.split("-");

  // "MM-DD" or "M-D"
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { month: m, day: d };

    // "February-1" (month name with hyphen)
    const mName = MONTH_NAMES[parts[0].toLowerCase()];
    const d2 = parseInt(parts[1], 10);
    if (mName && d2 >= 1 && d2 <= 31) return { month: mName, day: d2 };
  }

  // "February 1" or "Feb 1"
  const spaceMatch = value.trim().match(/^([a-zA-Z]+)\s+(\d{1,2})$/);
  if (spaceMatch) {
    const m = MONTH_NAMES[spaceMatch[1].toLowerCase()];
    const d = parseInt(spaceMatch[2], 10);
    if (m && d >= 1 && d <= 31) return { month: m, day: d };
  }

  return null;
}
