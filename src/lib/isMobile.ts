export const isMobile =
  typeof navigator !== "undefined" &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 768));

export const isIOS =
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod/i.test(navigator.userAgent);

export const isAndroid =
  typeof navigator !== "undefined" &&
  /Android/i.test(navigator.userAgent);
