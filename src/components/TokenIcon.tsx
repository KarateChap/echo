import type { ReactNode } from "react";

/**
 * Pool of SVG token icons for custom tokens.
 * Each is a small geometric shape that looks professional and distinct.
 */
const CUSTOM_ICONS: Record<string, (size: number) => ReactNode> = {
  hexagon: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5L12 2Z" fill="#8B5CF6" opacity={0.9} />
      <path d="M12 6L17 9V15L12 18L7 15V9L12 6Z" fill="#A78BFA" opacity={0.6} />
    </svg>
  ),
  shield: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M12 2L4 6V12C4 16.42 7.4 20.56 12 22C16.6 20.56 20 16.42 20 12V6L12 2Z" fill="#06B6D4" opacity={0.9} />
      <path d="M12 6L8 8.2V12.4C8 15.04 9.72 17.52 12 18.4C14.28 17.52 16 15.04 16 12.4V8.2L12 6Z" fill="#22D3EE" opacity={0.5} />
    </svg>
  ),
  cube: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M12 2L22 7V17L12 22L2 17V7L12 2Z" fill="#F59E0B" opacity={0.85} />
      <path d="M12 2L22 7L12 12L2 7L12 2Z" fill="#FCD34D" opacity={0.5} />
      <path d="M12 12V22L2 17V7L12 12Z" fill="#D97706" opacity={0.3} />
    </svg>
  ),
  circle: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#10B981" opacity={0.85} />
      <circle cx="12" cy="12" r="6" fill="#34D399" opacity={0.5} />
      <circle cx="12" cy="12" r="2.5" fill="#6EE7B7" opacity={0.7} />
    </svg>
  ),
  star: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M12 2L14.9 8.6L22 9.5L17 14.3L18.2 21.3L12 17.8L5.8 21.3L7 14.3L2 9.5L9.1 8.6L12 2Z" fill="#EC4899" opacity={0.85} />
      <path d="M12 6L13.8 10.2L18.4 10.7L15.2 13.7L16 18.2L12 15.9L8 18.2L8.8 13.7L5.6 10.7L10.2 10.2L12 6Z" fill="#F9A8D4" opacity={0.45} />
    </svg>
  ),
  triangle: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M12 3L22 21H2L12 3Z" fill="#3B82F6" opacity={0.85} />
      <path d="M12 9L17 19H7L12 9Z" fill="#93C5FD" opacity={0.45} />
    </svg>
  ),
  diamond: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M12 1L23 12L12 23L1 12L12 1Z" fill="#F97316" opacity={0.85} />
      <path d="M12 6L18 12L12 18L6 12L12 6Z" fill="#FDBA74" opacity={0.5} />
    </svg>
  ),
  octagon: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M8 2H16L22 8V16L16 22H8L2 16V8L8 2Z" fill="#EF4444" opacity={0.85} />
      <path d="M10 6H14L18 10V14L14 18H10L6 14V10L10 6Z" fill="#FCA5A5" opacity={0.45} />
    </svg>
  ),
  bolt: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#6366F1" opacity={0.85} />
      <path d="M13 2.05V10H20.94C20.45 5.94 17.31 2.73 13.25 2.05H13ZM4.06 14C4.47 17.61 7.32 20.5 11 21V14H4.06Z" fill="#A5B4FC" opacity={0.45} />
    </svg>
  ),
  ring: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#14B8A6" opacity={0.85} />
      <circle cx="12" cy="12" r="6" fill="#0F172A" opacity={0.6} />
      <circle cx="12" cy="12" r="3" fill="#5EEAD4" opacity={0.7} />
    </svg>
  ),
  cross: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M9 2H15V9H22V15H15V22H9V15H2V9H9V2Z" fill="#A855F7" opacity={0.85} />
      <path d="M11 5H13V11H19V13H13V19H11V13H5V11H11V5Z" fill="#D8B4FE" opacity={0.45} />
    </svg>
  ),
  pentagon: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M12 2L22 9.5L18.5 21H5.5L2 9.5L12 2Z" fill="#0EA5E9" opacity={0.85} />
      <path d="M12 7L17 11.5L15 19H9L7 11.5L12 7Z" fill="#7DD3FC" opacity={0.45} />
    </svg>
  ),
};

export const CUSTOM_ICON_KEYS = Object.keys(CUSTOM_ICONS);

/** Pick a random icon key from the pool */
export function randomIconKey(): string {
  return CUSTOM_ICON_KEYS[Math.floor(Math.random() * CUSTOM_ICON_KEYS.length)];
}

interface Props {
  icon: string;
  size?: number;
  className?: string;
}

export default function TokenIcon({ icon, size = 20, className = "" }: Props) {
  // If it matches a custom SVG key, render the SVG
  if (CUSTOM_ICONS[icon]) {
    return <span className={`inline-flex items-center justify-center ${className}`}>{CUSTOM_ICONS[icon](size)}</span>;
  }

  // Fallback: render as emoji text
  return <span className={className}>{icon}</span>;
}
