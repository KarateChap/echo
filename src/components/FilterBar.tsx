import { DatePicker } from "./DatePicker";

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  statuses: string[];
  activeStatus: string;
  onStatusChange: (value: string) => void;
  filteredCount: number;
  totalCount: number;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  statuses,
  activeStatus,
  onStatusChange,
  filteredCount,
  totalCount,
}: FilterBarProps) {
  return (
    <div className="shrink-0 space-y-2 pb-3">
      <input
        type="text"
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        className="glass-input w-full text-sm"
      />

      <div className="flex flex-wrap gap-1">
        {["all", ...statuses].map((status) => (
          <button
            key={status}
            onClick={() => onStatusChange(status === "all" ? "" : status)}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize transition ${
              (status === "all" ? activeStatus === "" : activeStatus === status)
                ? "border-primary bg-primary/30 text-white shadow-[0_0_8px_rgba(var(--primary-rgb),0.4)]"
                : "border-white/20 bg-white/10 text-white/80 hover:border-white/30 hover:bg-white/15"
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <DatePicker value={dateFrom} onChange={onDateFromChange} placeholder="From" rangeStart={dateTo} rangeRole="from" />
        <DatePicker value={dateTo} onChange={onDateToChange} placeholder="To" rangeStart={dateFrom} rangeRole="to" />
      </div>

      {filteredCount !== totalCount && (
        <p className="text-xs text-white/40">
          Showing {filteredCount} of {totalCount}
        </p>
      )}
    </div>
  );
}
