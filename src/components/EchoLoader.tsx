export function EchoLoader({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      {/* Animated rings */}
      <div className="relative h-16 w-16">
        <div className="absolute inset-0 animate-[spin_2.5s_linear_infinite] rounded-full border-2 border-transparent border-t-primary opacity-80" />
        <div className="absolute inset-1.5 animate-[spin_1.8s_linear_infinite_reverse] rounded-full border-2 border-transparent border-t-primary-glow opacity-60" />
        <div className="absolute inset-3 animate-[spin_1.2s_linear_infinite] rounded-full border-2 border-transparent border-t-accent opacity-40" />
        {/* Center dot pulse */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-2 w-2 animate-pulse rounded-full bg-primary-glow" />
        </div>
      </div>
      {/* Brand + message */}
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-sm font-medium tracking-wider text-white/70">echo</span>
        <span className="text-xs text-white/35">{message}</span>
      </div>
    </div>
  );
}
