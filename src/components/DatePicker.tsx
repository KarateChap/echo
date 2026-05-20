import { useState, useRef, useEffect, useCallback } from "react";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { isMobile } from "@/lib/isMobile";

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rangeStart?: string;
  rangeRole?: "from" | "to";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function toDateString(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDisplay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isToday(year: number, month: number, day: number) {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() === month && now.getDate() === day;
}

function parseDateStr(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}

export function DatePicker({ value, onChange, placeholder = "Date", rangeStart, rangeRole }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Determine initial view month/year
  const initDate = value ? parseDateStr(value) : { year: new Date().getFullYear(), month: new Date().getMonth() };
  const [viewYear, setViewYear] = useState(initDate.year);
  const [viewMonth, setViewMonth] = useState(initDate.month);

  // Sync view when value changes externally
  useEffect(() => {
    if (value) {
      const { year, month } = parseDateStr(value);
      setViewYear(year);
      setViewMonth(month);
    }
  }, [value]);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 150);
  }, []);

  // Click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        handleClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, handleClose]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, handleClose]);

  // Prevent body scroll on mobile when open
  useEffect(() => {
    if (!isMobile) return;
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const selectDay = (day: number) => {
    onChange(toDateString(viewYear, viewMonth, day));
    handleClose();
  };

  // Build calendar grid
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);

  // Range logic
  const rangeMin = rangeRole === "from" ? value : rangeStart;
  const rangeMax = rangeRole === "to" ? value : rangeStart;
  const hasRange = !!(rangeMin && rangeMax && rangeMin <= rangeMax);

  function getDayClasses(day: number) {
    const dateStr = toDateString(viewYear, viewMonth, day);
    const selected = dateStr === value;
    const today = isToday(viewYear, viewMonth, day);
    const inRange = hasRange && dateStr > rangeMin! && dateStr < rangeMax!;
    const isRangeStart = hasRange && dateStr === rangeMin;
    const isRangeEnd = hasRange && dateStr === rangeMax;

    let cls =
      "relative flex items-center justify-center w-8 h-8 text-xs rounded-lg cursor-pointer transition-all duration-150 ";

    if (selected) {
      cls += "bg-gradient-to-br from-primary to-accent text-white font-semibold shadow-[0_0_12px_rgba(99,102,241,0.4)] ";
    } else if (inRange) {
      cls += "bg-primary/15 text-white/80 rounded-none ";
      if (isRangeStart) cls += "rounded-l-lg ";
      if (isRangeEnd) cls += "rounded-r-lg ";
    } else if (today) {
      cls += "border border-primary/40 text-primary font-medium ";
    } else {
      cls += "text-white/70 hover:bg-white/10 ";
    }

    // Range edge rounding
    if (isRangeStart && !selected) cls += "rounded-l-lg ";
    if (isRangeEnd && !selected) cls += "rounded-r-lg ";

    return cls;
  }

  const visible = open || closing;

  const calendarContent = (
    <div
      className={`glass-card p-3 ${
        isMobile
          ? "fixed inset-x-3 bottom-3 z-50 w-auto"
          : `absolute top-full z-50 mt-1 w-[280px] ${rangeRole === "to" ? "right-0" : "left-0"}`
      }`}
      style={{
        animation: closing
          ? "calendar-exit 150ms ease-in forwards"
          : "calendar-enter 150ms ease-out forwards",
      }}
      role="dialog"
      aria-label="Choose date"
    >
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs font-semibold text-white/90">
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <button
          onClick={nextMonth}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Weekday labels */}
      <div className="mb-1 grid grid-cols-7 gap-0">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="flex items-center justify-center text-[10px] font-medium text-white/30">
            {wd}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0">
        {cells.map((day, i) =>
          day === null ? (
            <div key={`empty-${i}`} className="h-8 w-8" />
          ) : (
            <button
              key={day}
              onClick={() => selectDay(day)}
              className={getDayClasses(day)}
              aria-label={formatDisplay(toDateString(viewYear, viewMonth, day))}
              aria-current={isToday(viewYear, viewMonth, day) ? "date" : undefined}
            >
              {day}
            </button>
          )
        )}
      </div>

      {/* Today shortcut */}
      <div className="mt-2 flex justify-center">
        <button
          onClick={() => {
            const now = new Date();
            onChange(toDateString(now.getFullYear(), now.getMonth(), now.getDate()));
            handleClose();
          }}
          className="rounded-lg px-3 py-1 text-[10px] font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80"
        >
          Today
        </button>
      </div>
    </div>
  );

  return (
    <div ref={wrapperRef} className="relative min-w-0 flex-1">
      {/* Trigger */}
      <button
        onClick={() => (open ? handleClose() : setOpen(true))}
        className="glass-input flex w-full cursor-pointer items-center gap-2 text-xs"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Calendar size={14} className="shrink-0 text-white/40" />
        <span className={value ? "text-foreground" : "text-white/30"}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        {value && (
          <button
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
            className="ml-auto rounded p-0.5 text-white/40 transition hover:bg-white/10 hover:text-white/70"
            aria-label="Clear date"
          >
            <X size={12} />
          </button>
        )}
      </button>

      {/* Mobile backdrop */}
      {visible && isMobile && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          style={{
            animation: closing
              ? "calendar-exit 150ms ease-in forwards"
              : "calendar-enter 150ms ease-out forwards",
          }}
          onClick={handleClose}
        />
      )}

      {/* Calendar */}
      {visible && calendarContent}
    </div>
  );
}
