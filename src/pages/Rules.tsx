import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useMutation } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useUnseenCounts } from "@/lib/useUnseenCounts";
import { FilterBar } from "@/components/FilterBar";
import { useVoiceRecorder } from "@/lib/useVoiceRecorder";
import { VoicePlayer } from "@/components/VoicePlayer";
import { formatSchedule } from "@/lib/formatSchedule";

const PAGE_SIZE = 10;

export default function Rules() {
  const { user } = usePrivy();
  const rules = useQuery(
    api.rules.listByUser,
    user ? { privyId: user.id } : "skip",
  );
  const { markRulesSeen } = useUnseenCounts();
  const cancelRule = useMutation(api.rules.cancel);
  const pauseRule = useMutation(api.rules.pause);
  const resumeRule = useMutation(api.rules.resume);
  const generateUploadUrl = useMutation(api.voiceMessages.generateUploadUrl);
  const updateVoiceMessage = useMutation(api.voiceMessages.updateVoiceMessage);
  const msgRecorder = useVoiceRecorder();
  const [recordingForRuleId, setRecordingForRuleId] = useState<Id<"rules"> | null>(null);
  const [uploading, setUploading] = useState(false);
  const msgStartRef = useRef(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const RULE_STATUSES = ["active", "pending", "paused", "completed", "cancelled"];

  const filteredRules = useMemo(() => {
    if (!rules) return undefined;
    const sorted = [...rules].sort((a, b) => b._creationTime - a._creationTime);
    return sorted.filter((rule) => {
      if (search && !rule.recipientName.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter && rule.status !== statusFilter) return false;
      if (dateFrom) {
        const from = new Date(dateFrom).getTime();
        if (rule._creationTime < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo).getTime() + 86_400_000;
        if (rule._creationTime >= to) return false;
      }
      return true;
    });
  }, [rules, search, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    markRulesSeen();
  }, [markRulesSeen]);

  const loadMore = useCallback(() => {
    if (filteredRules) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredRules.length));
    }
  }, [filteredRules]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const handleStartRecording = async (ruleId: Id<"rules">) => {
    setRecordingForRuleId(ruleId);
    msgStartRef.current = Date.now();
    await msgRecorder.startRecording();
  };

  const handleStopRecording = async () => {
    if (!recordingForRuleId || !user) return;
    const blob = await msgRecorder.stopRecording();
    if (!blob) { setRecordingForRuleId(null); return; }
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const elapsed = Date.now() - msgStartRef.current;
      await updateVoiceMessage({
        privyId: user.id,
        ruleId: recordingForRuleId,
        storageId,
        durationSec: Math.max(1, Math.floor(elapsed / 1000)),
      });
    } catch (e) {
      console.error("Failed to upload voice message:", e);
    } finally {
      setRecordingForRuleId(null);
      setUploading(false);
    }
  };

  const [confirmAction, setConfirmAction] = useState<{
    ruleId: Id<"rules">;
    action: "pause" | "cancel";
    recipientName: string;
    amountUsdc: number;
    token?: string;
  } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const visibleRules = filteredRules?.slice(0, visibleCount);
  const hasMore = filteredRules ? visibleCount < filteredRules.length : false;

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col px-6">
      <header className="flex shrink-0 items-center gap-3 py-6">
        <Link to="/app" className="glass-nav text-sm">← Back</Link>
        <h1 className="text-xl font-semibold">Rules</h1>
      </header>

      {rules === undefined && <p className="text-sm text-white/50">Loading…</p>}

      {rules && rules.length === 0 && <p className="text-sm text-white/50">No active rules yet.</p>}

      {rules && rules.length > 0 && (
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search recipients…"
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          statuses={RULE_STATUSES}
          activeStatus={statusFilter}
          onStatusChange={setStatusFilter}
          filteredCount={filteredRules?.length ?? 0}
          totalCount={rules.length}
        />
      )}

      {filteredRules && filteredRules.length === 0 && rules && rules.length > 0 && (
        <p className="text-sm text-white/50">No rules match your filters.</p>
      )}

      {visibleRules && visibleRules.length > 0 && (
        <div className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6" style={{ maskImage: "linear-gradient(to bottom, transparent 0%, black 2%, black 95%, transparent 100%)" }}>
          <div className="space-y-3">
            {visibleRules.map((rule) => {
              const isExpanded = expandedId === rule._id;
              const scheduleText = rule.kind === "recurring" && rule.schedule
                ? formatSchedule(rule.schedule)
                : rule.kind === "conditional" && rule.condition
                ? `When below ${rule.condition.walletBelowUsdc} ${rule.token ?? "USDC"} → top up ${rule.condition.topUpUsdc} ${rule.token ?? "USDC"}`
                : "One-time";

              return (
                <div
                  key={rule._id}
                  className="glass-card glass-card-hover space-y-2 p-4 text-sm cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : rule._id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{rule.recipientName}</span>
                    <div className="flex items-center gap-2">
                      <span className={`glass-badge ${
                        rule.status === "active" ? "bg-green-500/15 text-green-400 border-green-500/20" :
                        rule.status === "completed" ? "bg-blue-500/15 text-blue-400 border-blue-500/20" :
                        rule.status === "paused" ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/20" :
                        rule.status === "pending" ? "bg-orange-500/15 text-orange-400 border-orange-500/20" :
                        "bg-white/10 text-white/50"
                      }`}>
                        {rule.status}
                      </span>
                      <svg
                        className={`h-4 w-4 text-white/40 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  <div className="text-lg font-semibold">{rule.amountUsdc.toLocaleString()} {rule.token ?? "USDC"}</div>
                  <div className="text-white/50">{scheduleText}</div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="space-y-3 border-t border-white/10 pt-3" onClick={(e) => e.stopPropagation()}>
                      {/* Detail rows */}
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-white/40">Type</span>
                          <span className="text-white/70 capitalize">{rule.kind === "oneShot" ? "One-time" : rule.kind}</span>
                        </div>
                        {rule.recipientEmail && (
                          <div className="flex justify-between">
                            <span className="text-white/40">Recipient email</span>
                            <span className="text-white/70">{rule.recipientEmail}</span>
                          </div>
                        )}
                        {rule.kind === "recurring" && rule.schedule && (
                          <>
                            <div className="flex justify-between">
                              <span className="text-white/40">Schedule type</span>
                              <span className="text-white/70 capitalize">{rule.schedule.kind}</span>
                            </div>
                            {rule.schedule.kind === "cron" && (
                              <div className="flex justify-between">
                                <span className="text-white/40">Cron expression</span>
                                <span className="font-mono text-white/70">{rule.schedule.value}</span>
                              </div>
                            )}
                          </>
                        )}
                        {rule.nextRunAt && (
                          <div className="flex justify-between">
                            <span className="text-white/40">Next run</span>
                            <span className="text-white/70">{new Date(rule.nextRunAt).toLocaleString()}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-white/40">Created</span>
                          <span className="text-white/70">{new Date(rule._creationTime).toLocaleDateString()}</span>
                        </div>
                      </div>

                      {/* Voice message player / recorder */}
                      <div className="space-y-4">
                        {rule.voiceMessageUrl ? (
                          <div>
                            <span className="mb-4 block text-[10px] font-medium uppercase tracking-wider text-white/40">Voice message</span>
                            <VoicePlayer url={rule.voiceMessageUrl} duration={rule.voiceMessageDuration} />
                          </div>
                        ) : rule.voiceMessageId ? (
                          <div className="space-y-1">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Voice message</span>
                            <p className="text-xs text-white/30">Voice message unavailable</p>
                          </div>
                        ) : null}

                        {/* Recording UI */}
                        {recordingForRuleId === rule._id ? (
                          <div className="flex items-center gap-3 rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-2">
                            <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                            <span className="flex-1 text-xs text-white/70">
                              Recording… {Math.floor(msgRecorder.elapsedMs / 1000)}s
                            </span>
                            <button
                              onClick={handleStopRecording}
                              className="rounded-lg border border-white/20 bg-white/10 px-3 py-1 text-xs text-white transition hover:bg-white/20"
                            >
                              Stop
                            </button>
                          </div>
                        ) : uploading && recordingForRuleId === rule._id ? (
                          <p className="text-xs text-white/40">Uploading…</p>
                        ) : (rule.status === "active" || rule.status === "paused") ? (
                          <button
                            onClick={() => handleStartRecording(rule._id)}
                            className="flex items-center gap-1.5 rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-1.5 text-xs text-purple-300 transition hover:bg-purple-500/20"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                            </svg>
                            {rule.voiceMessageId ? "Update Voice Message" : "Record Voice Message"}
                          </button>
                        ) : null}
                      </div>

                      {/* Action buttons */}
                      {(rule.status === "active" || rule.status === "paused") && (
                        <div className="flex gap-2 pt-1">
                          {rule.status === "active" && (
                            <button
                              onClick={() => setConfirmAction({ ruleId: rule._id, action: "pause", recipientName: rule.recipientName, amountUsdc: rule.amountUsdc, token: rule.token })}
                              className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-400 transition hover:bg-yellow-500/20"
                            >
                              Pause
                            </button>
                          )}
                          {rule.status === "paused" && (
                            <button
                              onClick={() => resumeRule({ ruleId: rule._id })}
                              className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs text-green-400 transition hover:bg-green-500/20"
                            >
                              Resume
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmAction({ ruleId: rule._id, action: "cancel", recipientName: rule.recipientName, amountUsdc: rule.amountUsdc, token: rule.token })}
                            className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs text-red-400 transition hover:bg-red-500/20"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Collapsed: show voice indicator and action buttons */}
                  {!isExpanded && (
                    <>
                      {rule.voiceMessageId && (
                        <div className="text-[10px] text-white/40">🎙 Voice message attached</div>
                      )}
                      {(rule.status === "active" || rule.status === "paused") && (
                        <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                          {rule.status === "active" && (
                            <button
                              onClick={() => setConfirmAction({ ruleId: rule._id, action: "pause", recipientName: rule.recipientName, amountUsdc: rule.amountUsdc, token: rule.token })}
                              className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-400 transition hover:bg-yellow-500/20"
                            >
                              Pause
                            </button>
                          )}
                          {rule.status === "paused" && (
                            <button
                              onClick={() => resumeRule({ ruleId: rule._id })}
                              className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs text-green-400 transition hover:bg-green-500/20"
                            >
                              Resume
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmAction({ ruleId: rule._id, action: "cancel", recipientName: rule.recipientName, amountUsdc: rule.amountUsdc, token: rule.token })}
                            className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs text-red-400 transition hover:bg-red-500/20"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {hasMore && (
              <div ref={sentinelRef} className="flex justify-center py-4">
                <span className="text-xs text-white/40">Loading more…</span>
              </div>
            )}

            {!hasMore && filteredRules && filteredRules.length > PAGE_SIZE && (
              <p className="py-4 text-center text-xs text-white/30">
                All {filteredRules.length} rules loaded
              </p>
            )}
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6"
          onClick={() => setConfirmAction(null)}
        >
          <div
            className="glass-card w-full max-w-sm space-y-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Icon */}
            <div className="flex justify-center">
              <div className={`flex h-12 w-12 items-center justify-center rounded-full ${
                confirmAction.action === "pause"
                  ? "bg-yellow-500/15 text-yellow-400"
                  : "bg-red-500/15 text-red-400"
              }`}>
                {confirmAction.action === "pause" ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                )}
              </div>
            </div>

            {/* Title */}
            <h2 className="text-center text-base font-semibold">
              {confirmAction.action === "pause" ? "Pause Rule?" : "Cancel Rule?"}
            </h2>

            {/* Description */}
            <p className="text-center text-sm text-white/50">
              Are you sure you want to {confirmAction.action} the rule sending{" "}
              <span className="font-medium text-white/80">
                {confirmAction.amountUsdc.toLocaleString()} {confirmAction.token ?? "USDC"}
              </span>{" "}
              to{" "}
              <span className="font-medium text-white/80">{confirmAction.recipientName}</span>?
            </p>
            <p className="text-center text-xs text-white/35">
              {confirmAction.action === "pause"
                ? "You can resume this rule anytime."
                : "This action cannot be undone."}
            </p>

            {/* Buttons */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setConfirmAction(null)}
                className="btn-secondary flex-1"
              >
                Go Back
              </button>
              <button
                onClick={async () => {
                  if (confirmAction.action === "pause") {
                    await pauseRule({ ruleId: confirmAction.ruleId });
                  } else {
                    await cancelRule({ ruleId: confirmAction.ruleId });
                  }
                  setConfirmAction(null);
                }}
                className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                  confirmAction.action === "pause"
                    ? "border border-yellow-500/20 bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25"
                    : "border border-red-500/20 bg-red-500/15 text-red-400 hover:bg-red-500/25"
                }`}
              >
                {confirmAction.action === "pause" ? "Pause" : "Cancel Rule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
