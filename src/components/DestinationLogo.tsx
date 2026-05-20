import { useState } from "react";
import { slugify } from "@/lib/slugify";
import type { Destination } from "@/lib/seaDestinations";

const EMOJI: Record<Destination["type"], string> = {
  ewallet: "\u{1F4F1}",
  bank: "\u{1F3E6}",
};

export function DestinationLogo({
  destination,
  size = "sm",
}: {
  destination: Destination;
  size?: "sm" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const px = size === "sm" ? "h-8 w-8" : "h-7 w-7";

  if (failed) {
    return (
      <span className={`flex ${px} items-center justify-center rounded-full bg-white/[0.06] text-sm`}>
        {EMOJI[destination.type]}
      </span>
    );
  }

  return (
    <img
      src={`/logos/${slugify(destination.name)}.png`}
      alt={destination.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${px} rounded-full object-contain`}
    />
  );
}
