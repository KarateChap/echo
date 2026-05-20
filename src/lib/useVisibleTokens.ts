import { useState, useCallback, useEffect } from "react";
import type { Token } from "./tokens";

const STORAGE_KEY = "echo-visible-tokens";
const HIDDEN_KEY = "echo-hidden-tokens";
const MAX_VISIBLE = 5;

function tokenKey(t: Token) {
  return `${t.symbol}::${t.address}`;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as T;
  } catch {}
  return fallback;
}

/**
 * Manages which tokens are visible in the orbit ring (max 5).
 * Persists to localStorage. No auto-add effects — completely deterministic.
 */
export function useVisibleTokens(allTokens: Token[]) {
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => {
    const stored = loadJson<string[]>(STORAGE_KEY, []);
    if (stored.length > 0) return stored;
    // First-time user: default to first 6
    return allTokens.slice(0, MAX_VISIBLE).map(tokenKey);
  });

  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(
    () => new Set(loadJson<string[]>(HIDDEN_KEY, [])),
  );

  // Persist
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleKeys));
  }, [visibleKeys]);

  useEffect(() => {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenKeys]));
  }, [hiddenKeys]);

  // Derive visible/hidden from stored keys + allTokens.
  // Dead keys (deleted tokens) are naturally filtered out by the .find().
  const visibleTokens = visibleKeys
    .map((k) => allTokens.find((t) => tokenKey(t) === k))
    .filter(Boolean) as Token[];

  const hiddenTokens = allTokens.filter((t) => !visibleKeys.includes(tokenKey(t)));

  const hideToken = useCallback((token: Token) => {
    const k = tokenKey(token);
    setVisibleKeys((prev) => prev.filter((key) => key !== k));
    setHiddenKeys((prev) => {
      if (prev.has(k)) return prev;
      return new Set([...prev, k]);
    });
  }, []);

  const showToken = useCallback((token: Token) => {
    const k = tokenKey(token);
    setVisibleKeys((prev) => {
      if (prev.length >= MAX_VISIBLE || prev.includes(k)) return prev;
      return [...prev, k];
    });
    setHiddenKeys((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Set(prev);
      next.delete(k);
      return next;
    });
  }, []);

  const removeToken = useCallback((token: Token) => {
    const k = tokenKey(token);
    setVisibleKeys((prev) => prev.filter((key) => key !== k));
    setHiddenKeys((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Set(prev);
      next.delete(k);
      return next;
    });
  }, []);

  return { visibleTokens, hiddenTokens, hideToken, showToken, removeToken, MAX_VISIBLE };
}
