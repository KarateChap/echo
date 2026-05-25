/**
 * Server Time — Single Source of Truth
 *
 * All time-dependent logic in the Convex backend MUST use these helpers
 * instead of raw `Date.now()` or `new Date()`.
 *
 * In Convex, mutations/queries/actions run on the server, so `Date.now()`
 * already returns server time. This module makes that intent explicit and
 * prevents any future drift toward client-supplied timestamps.
 */

/** Returns the current server timestamp in milliseconds (epoch). */
export function serverNow(): number {
  return Date.now();
}

/** Returns a `Date` object set to the current server time. */
export function serverDate(): Date {
  return new Date(serverNow());
}
