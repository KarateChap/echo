import { useCallback, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function useUnseenCounts() {
  const { user } = usePrivy();

  const dbUser = useQuery(
    api.users.getByPrivyId,
    user ? { privyId: user.id } : "skip",
  );

  const lastSeenActivity = dbUser?.lastSeenActivity ?? 0;
  const lastSeenRules = dbUser?.lastSeenRules ?? 0;

  const unseenActivity = useQuery(
    api.transactions.countUnseenByUser,
    user ? { privyId: user.id, since: lastSeenActivity } : "skip",
  ) ?? 0;

  const rules = useQuery(
    api.rules.listByUser,
    user ? { privyId: user.id } : "skip",
  );

  const markSeen = useMutation(api.users.markSectionSeen);

  const unseenRules = rules
    ? rules.filter((r) => r._creationTime > lastSeenRules).length
    : 0;

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
