import { useMemo, useCallback, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function useUnseenCounts() {
  const { user } = usePrivy();

  const dbUser = useQuery(
    api.users.getByPrivyId,
    user ? { privyId: user.id } : "skip",
  );

  const txs = useQuery(
    api.transactions.listByUser,
    user ? { privyId: user.id } : "skip",
  );

  const rules = useQuery(
    api.rules.listByUser,
    user ? { privyId: user.id } : "skip",
  );

  const markSeen = useMutation(api.users.markSectionSeen);

  const unseenActivity = useMemo(() => {
    if (!txs) return 0;
    const lastSeen = dbUser?.lastSeenActivity ?? 0;
    return txs.filter((tx) => (tx.executedAt ?? tx._creationTime) > lastSeen).length;
  }, [txs, dbUser]);

  const unseenRules = useMemo(() => {
    if (!rules) return 0;
    const lastSeen = dbUser?.lastSeenRules ?? 0;
    return rules.filter((r) => r._creationTime > lastSeen).length;
  }, [rules, dbUser]);

  const markActivitySeen = useCallback(() => {
    if (user) markSeen({ privyId: user.id, section: "activity" });
  }, [user, markSeen]);

  const markRulesSeen = useCallback(() => {
    if (user) markSeen({ privyId: user.id, section: "rules" });
  }, [user, markSeen]);

  // Clean up old localStorage keys
  useEffect(() => {
    localStorage.removeItem("echo:lastSeenActivity");
    localStorage.removeItem("echo:lastSeenRules");
  }, []);

  return { unseenActivity, unseenRules, markActivitySeen, markRulesSeen };
}
