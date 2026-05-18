import { useEffect, useMemo, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const ACTIVITY_KEY = "echo:lastSeenActivity";
const RULES_KEY = "echo:lastSeenRules";

function getTimestamp(key: string): number {
  const val = localStorage.getItem(key);
  return val ? parseInt(val, 10) : 0;
}

function setTimestamp(key: string) {
  localStorage.setItem(key, Date.now().toString());
}

export function useUnseenCounts() {
  const { user } = usePrivy();

  const txs = useQuery(
    api.transactions.listByUser,
    user ? { privyId: user.id } : "skip",
  );

  const rules = useQuery(
    api.rules.listByUser,
    user ? { privyId: user.id } : "skip",
  );

  const unseenActivity = useMemo(() => {
    if (!txs) return 0;
    const lastSeen = getTimestamp(ACTIVITY_KEY);
    return txs.filter((tx) => (tx.executedAt ?? tx._creationTime) > lastSeen).length;
  }, [txs]);

  const unseenRules = useMemo(() => {
    if (!rules) return 0;
    const lastSeen = getTimestamp(RULES_KEY);
    return rules.filter((r) => r._creationTime > lastSeen).length;
  }, [rules]);

  const markActivitySeen = useCallback(() => setTimestamp(ACTIVITY_KEY), []);
  const markRulesSeen = useCallback(() => setTimestamp(RULES_KEY), []);

  return { unseenActivity, unseenRules, markActivitySeen, markRulesSeen };
}
