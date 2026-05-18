import { useState, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useMutation } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

function truncateAddress(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

type RecipientForm = {
  displayName: string;
  contactEmail: string;
  relationship: string;
  walletAddress: string;
};

const emptyForm: RecipientForm = { displayName: "", contactEmail: "", relationship: "", walletAddress: "" };

export default function Recipients() {
  const { user } = usePrivy();
  const recipients = useQuery(
    api.recipients.listByOwner,
    user ? { privyId: user.id } : "skip",
  );
  const addRecipient = useMutation(api.recipients.add);
  const updateRecipient = useMutation(api.recipients.update);
  const removeRecipient = useMutation(api.recipients.remove);

  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<Id<"recipients"> | null>(null);
  const [form, setForm] = useState<RecipientForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<{ id: Id<"recipients">; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    if (!recipients) return undefined;
    if (!search) return recipients;
    const q = search.toLowerCase();
    return recipients.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        (r.relationship && r.relationship.toLowerCase().includes(q)) ||
        (r.contactEmail && r.contactEmail.toLowerCase().includes(q)),
    );
  }, [recipients, search]);

  function copyWallet(id: string, address: string) {
    navigator.clipboard.writeText(address);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(r: NonNullable<typeof recipients>[number]) {
    setEditingId(r._id);
    setForm({
      displayName: r.displayName,
      contactEmail: r.contactEmail ?? "",
      relationship: r.relationship ?? "",
      walletAddress: r.walletAddress ?? "",
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSave() {
    if (!user || !form.displayName.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateRecipient({
          recipientId: editingId,
          displayName: form.displayName.trim(),
          contactEmail: form.contactEmail.trim() || undefined,
          relationship: form.relationship.trim() || undefined,
          walletAddress: form.walletAddress.trim() || undefined,
        });
      } else {
        await addRecipient({
          privyId: user.id,
          displayName: form.displayName.trim(),
          contactEmail: form.contactEmail.trim() || undefined,
          relationship: form.relationship.trim() || undefined,
          walletAddress: form.walletAddress.trim() || undefined,
        });
      }
      closeForm();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await removeRecipient({ recipientId: deleteTarget.id });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col px-6">
      <header className="flex shrink-0 items-center gap-3 py-6">
        <Link to="/app" className="glass-nav text-sm">← Back</Link>
        <h1 className="text-xl font-semibold">Recipients</h1>
        <button
          onClick={openAdd}
          className="ml-auto rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-purple-500 active:scale-95"
        >
          + Add
        </button>
      </header>

      {recipients === undefined && <p className="text-sm text-white/50">Loading…</p>}

      {recipients && recipients.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-white/50">No recipients yet.</p>
          <button
            onClick={openAdd}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-500"
          >
            Add your first recipient
          </button>
        </div>
      )}

      {recipients && recipients.length > 0 && (
        <>
          <div className="shrink-0 pb-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or relationship…"
              className="glass-input w-full text-sm"
            />
            {filtered && filtered.length !== recipients.length && (
              <p className="mt-1 text-xs text-white/40">
                Showing {filtered.length} of {recipients.length}
              </p>
            )}
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto"
            style={{
              maskImage:
                "linear-gradient(to bottom, transparent 0%, black 2%, black 95%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent 0%, black 2%, black 95%, transparent 100%)",
            }}
          >
            <div className="space-y-3 pb-6 pt-1">
              {filtered?.map((r) => (
                <div key={r._id} className="glass-card space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{r.displayName}</span>
                      {r.relationship && (
                        <span className="glass-badge text-[10px]">{r.relationship}</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => openEdit(r)}
                        className="rounded p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white/70"
                        title="Edit"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setDeleteTarget({ id: r._id, name: r.displayName })}
                        className="rounded p-1.5 text-white/40 transition hover:bg-red-500/20 hover:text-red-400"
                        title="Delete"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="text-sm text-white/60">
                    {r.contactEmail ?? <span className="italic text-white/30">No email</span>}
                  </div>

                  {r.walletAddress && (
                    <button
                      onClick={() => copyWallet(r._id, r.walletAddress!)}
                      className="flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 font-mono text-[11px] text-white/40 transition hover:bg-white/10 active:scale-95"
                    >
                      <span>{truncateAddress(r.walletAddress)}</span>
                      {copiedId === r._id ? (
                        <svg className="h-3 w-3 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="h-3 w-3 shrink-0 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={closeForm} />
          <div className="relative mx-4 mb-4 w-full max-w-md rounded-2xl border border-white/10 bg-[#1a1a2e] p-6 shadow-2xl sm:mb-0">
            <h2 className="mb-4 text-lg font-semibold">
              {editingId ? "Edit Recipient" : "Add Recipient"}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-white/50">Name *</label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder="e.g. Mama"
                  className="glass-input w-full text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/50">Email</label>
                <input
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                  placeholder="e.g. mama@gmail.com"
                  className="glass-input w-full text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/50">Relationship</label>
                <input
                  type="text"
                  value={form.relationship}
                  onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
                  placeholder="e.g. Mother, Wife, Friend"
                  className="glass-input w-full text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/50">Wallet Address</label>
                <input
                  type="text"
                  value={form.walletAddress}
                  onChange={(e) => setForm((f) => ({ ...f, walletAddress: e.target.value }))}
                  placeholder="0x..."
                  className="glass-input w-full font-mono text-sm"
                />
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                onClick={closeForm}
                className="flex-1 rounded-lg border border-white/10 px-4 py-2.5 text-sm text-white/60 transition hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.displayName.trim()}
                className="flex-1 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-40"
              >
                {saving ? "Saving…" : editingId ? "Save Changes" : "Add Recipient"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative mx-4 mb-4 w-full max-w-sm rounded-2xl border border-white/10 bg-[#1a1a2e] p-6 shadow-2xl sm:mb-0">
            <h2 className="mb-2 text-lg font-semibold">Delete Recipient?</h2>
            <p className="mb-5 text-sm text-white/60">
              Are you sure you want to delete <span className="font-medium text-white">{deleteTarget.name}</span>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-lg border border-white/10 px-4 py-2.5 text-sm text-white/60 transition hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
