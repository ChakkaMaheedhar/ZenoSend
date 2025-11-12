import React, { useEffect, useState } from "react";
import { useAuth } from "../auth";
import {
    getContacts,
    createContact,
    validateOne,
    updateContact,
    type ContactRow,
} from "../api";

export default function ContactsPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === "admin";

    const [rows, setRows] = useState<ContactRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // Add Contact Form
    const [fn, setFn] = useState("");
    const [ln, setLn] = useState("");
    const [email, setEmail] = useState("");
    const [li, setLi] = useState("");
    const [valBusy, setValBusy] = useState(false);
    const [valPreview, setValPreview] = useState<{
        status: string;
        reason?: string | null;
        provider?: string | null;
    } | null>(null);
    const smtpAlwaysOn = true;

    // Modal
    const [selectedRecruiter, setSelectedRecruiter] = useState<string | null>(null);
    const [expandedContact, setExpandedContact] = useState<ContactRow | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editValues, setEditValues] = useState({
        first_name: "",
        last_name: "",
        linkedin_url: "",
        phone: "",
    });

    useEffect(() => {
        load();
    }, []);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            const data = await getContacts();
            setRows(Array.isArray(data) ? data : []);
        } catch (e: any) {
            const errorMsg = e.message || "Failed to load contacts";
            setErr(errorMsg);
            console.error("Error loading contacts:", e);
            // Don't clear rows on error - keep existing data visible
            // setRows([]); // Only clear if we're sure we want to show empty state
        } finally {
            setLoading(false);
        }
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        try {
            if (!email.trim()) throw new Error("Email is required");
            await createContact({
                first_name: fn || undefined,
                last_name: ln || undefined,
                email: email.trim().toLowerCase(),
                linkedin_url: li || undefined,
            });
            resetForm();
            await load();
        } catch (e: any) {
            setErr(e.message || "Failed to create contact");
        }
    }

    async function handleValidateAndSave(e: React.FormEvent) {
        e.preventDefault();
        if (!email.trim()) {
            setErr("Email is required");
            return;
        }
        setErr(null);
        setValBusy(true);
        try {
            const addr = email.trim().toLowerCase();
            const r = await validateOne(addr); // full SMTP probe
            setValPreview({
                status: r.status,
                reason: r.reason ?? null,
                provider: r.provider ?? null,
            });
            await createContact({
                first_name: fn || undefined,
                last_name: ln || undefined,
                email: addr,
                linkedin_url: li || undefined,
            });
            resetForm();
            await load();
        } catch (e: any) {
            setErr(e.message || "Validate & Save failed");
        } finally {
            setValBusy(false);
        }
    }

    function resetForm() {
        setFn("");
        setLn("");
        setEmail("");
        setLi("");
        setValPreview(null);
    }

    const grouped = isAdmin
        ? (Array.isArray(rows) ? rows : []).reduce((acc, r) => {
            const owner = r.owner_email || "Unknown";
            if (!acc[owner]) acc[owner] = [];
            acc[owner].push(r);
            return acc;
        }, {} as Record<string, ContactRow[]>)
        : { [user?.email || "Me"]: Array.isArray(rows) ? rows : [] };

    async function handleRevalidate(email: string) {
        try {
            await validateOne(email);
            await load();
        } catch (err) {
            console.error("Revalidate failed:", err);
        }
    }

    async function handleEditSave() {
        if (!expandedContact) return;
        setSaving(true);
        try {
            await updateContact(expandedContact.id, {
                first_name: editValues.first_name,
                last_name: editValues.last_name,
                linkedin_url: editValues.linkedin_url,
                phone: editValues.phone,
            });
            setEditMode(false);
            await load();
            setSaving(false);
        } catch (e: any) {
            console.error(e);
            setSaving(false);
        }
    }

    const getStatusColor = (status?: string) => {
        switch (status) {
            case "valid":
                return "text-green-400";
            case "risky":
                return "text-yellow-400";
            case "invalid":
                return "text-red-400";
            default:
                return "text-gray-400";
        }
    };

    return (
        <div className="container mx-auto px-4 py-6 space-y-6">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold">Contacts</h2>
                {user && (
                    <div className="text-sm opacity-80">
                        {user.email} · <span className="uppercase">{user.role}</span>
                    </div>
                )}
            </div>

            {/* --- Add / Validate form --- */}
            <form onSubmit={handleSave} className="card space-y-3 mb-6 p-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <input
                        className="input"
                        placeholder="First name"
                        value={fn}
                        onChange={(e) => setFn(e.target.value)}
                    />
                    <input
                        className="input"
                        placeholder="Last name"
                        value={ln}
                        onChange={(e) => setLn(e.target.value)}
                    />
                    <input
                        className="input"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                    <input
                        className="input"
                        placeholder="LinkedIn URL"
                        value={li}
                        onChange={(e) => setLi(e.target.value)}
                    />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <button type="submit" className="btn">
                        Save
                    </button>
                    <button
                        type="button"
                        className="btn"
                        onClick={handleValidateAndSave}
                        disabled={valBusy}
                    >
                        {valBusy ? "Validating…" : "Validate & Save"}
                    </button>
                    <label className="flex items-center gap-2 text-sm opacity-80">
                        <input type="checkbox" checked={smtpAlwaysOn} disabled />
                        Use SMTP probe (always on)
                    </label>
                    {valPreview && (
                        <span
                            className={`ml-2 text-sm px-2 py-[2px] rounded ${valPreview.status === "valid"
                                ? "bg-emerald-600/20 text-emerald-300"
                                : valPreview.status === "risky"
                                    ? "bg-amber-500/20 text-amber-300"
                                    : valPreview.status === "invalid"
                                        ? "bg-red-600/20 text-red-300"
                                        : "bg-slate-600/20 text-slate-300"
                                }`}
                        >
                            {valPreview.status}
                            {valPreview.provider ? ` · ${valPreview.provider}` : ""}
                            {valPreview.reason ? ` · ${valPreview.reason}` : ""}
                        </span>
                    )}
                </div>

                {err && <div className="text-red-400 text-sm">{err}</div>}
            </form>

            {/* --- Main View --- */}
            {loading ? (
                <div className="text-gray-400 text-center py-6">Loading...</div>
            ) : !isAdmin ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {rows.map((c) => (
                        <ContactCard key={c.id} contact={c} onExpand={setExpandedContact} />
                    ))}
                </div>
            ) : (
                <>
                    {!selectedRecruiter ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {Object.entries(grouped).map(([owner, contacts]) => (
                                <div
                                    key={owner}
                                    className="p-4 rounded-2xl border border-[rgba(174,194,228,0.6)] bg-white/90 hover:border-[rgba(120,178,245,0.75)] hover:bg-white transition-all cursor-pointer shadow-[0_26px_48px_-32px_rgba(143,165,255,0.4)]"
                                    onClick={() => setSelectedRecruiter(owner)}
                                >
                                    <div className="font-mono text-sm truncate text-slate-700">{owner}</div>
                                    <div className="text-xs text-slate-500 mt-1">
                                        Contacts: {contacts.length}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <button
                                    className="btn btn-small"
                                    onClick={() => setSelectedRecruiter(null)}
                                >
                                    ← Back to Recruiters
                                </button>
                                <h3 className="font-mono text-sm truncate">{selectedRecruiter}</h3>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                {grouped[selectedRecruiter]?.map((c) => (
                                    <ContactCard
                                        key={c.id}
                                        contact={c}
                                        onExpand={setExpandedContact}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* --- Details Modal with Inline Edit --- */}
            {expandedContact && (
                <div className="fixed inset-0 bg-white/60 backdrop-blur-xl flex items-center justify-center z-50">
                    <div className="p-6 rounded-3xl border border-[rgba(174,194,228,0.6)] bg-white shadow-[0_28px_70px_-40px_rgba(143,165,255,0.4)] max-w-lg w-full relative">
                        <button
                            className="absolute top-2 right-3 text-slate-400 hover:text-slate-700 text-xl"
                            onClick={() => {
                                setExpandedContact(null);
                                setEditMode(false);
                            }}
                        >
                            ×
                        </button>

                        {!editMode ? (
                            <>
                                <h3 className="text-lg font-semibold mb-4">
                                    {expandedContact.first_name} {expandedContact.last_name}
                                </h3>
                                <div className="text-sm space-y-1">
                                    <div><span className="text-slate-500">Email:</span> {expandedContact.email}</div>
                                    {expandedContact.phone && (
                                        <div><span className="text-slate-500">Phone:</span> {expandedContact.phone}</div>
                                    )}
                                    {expandedContact.linkedin_url && (
                                        <div>
                                            <span className="text-slate-500">LinkedIn:</span>{" "}
                                            <a
                                                href={expandedContact.linkedin_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="underline text-emerald-500"
                                            >
                                                {expandedContact.linkedin_url}
                                            </a>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3 mt-6">
                                    <button
                                        className="btn flex-1"
                                        onClick={() => {
                                            setEditValues({
                                                first_name: expandedContact.first_name || "",
                                                last_name: expandedContact.last_name || "",
                                                linkedin_url: expandedContact.linkedin_url || "",
                                                phone: expandedContact.phone || "",
                                            });
                                            setEditMode(true);
                                        }}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        className="btn flex-1"
                                        onClick={() => handleRevalidate(expandedContact.email)}
                                    >
                                        Re-validate
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h3 className="text-lg font-semibold mb-4">Edit Contact</h3>
                                <div className="space-y-3 text-sm">
                                    <input
                                        className="input w-full"
                                        placeholder="First name"
                                        value={editValues.first_name}
                                        onChange={(e) =>
                                            setEditValues((p) => ({ ...p, first_name: e.target.value }))
                                        }
                                    />
                                    <input
                                        className="input w-full"
                                        placeholder="Last name"
                                        value={editValues.last_name}
                                        onChange={(e) =>
                                            setEditValues((p) => ({ ...p, last_name: e.target.value }))
                                        }
                                    />
                                    <input
                                        className="input w-full"
                                        placeholder="Phone"
                                        value={editValues.phone}
                                        onChange={(e) =>
                                            setEditValues((p) => ({ ...p, phone: e.target.value }))
                                        }
                                    />
                                    <input
                                        className="input w-full"
                                        placeholder="LinkedIn URL"
                                        value={editValues.linkedin_url}
                                        onChange={(e) =>
                                            setEditValues((p) => ({
                                                ...p,
                                                linkedin_url: e.target.value,
                                            }))
                                        }
                                    />
                                </div>

                                <div className="flex gap-3 mt-6">
                                    <button
                                        className="btn btn-ghost flex-1"
                                        onClick={() => setEditMode(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="btn flex-1"
                                        onClick={handleEditSave}
                                        disabled={saving}
                                    >
                                        {saving ? "Saving…" : "Save"}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/* --- Card --- */
function ContactCard({
    contact,
    onExpand,
}: {
    contact: ContactRow;
    onExpand: (c: ContactRow) => void;
}) {
    const getStatusColor = (status?: string) => {
        switch (status) {
            case "valid":
                return "text-emerald-500";
            case "risky":
                return "text-amber-500";
            case "invalid":
                return "text-rose-500";
            default:
                return "text-slate-500";
        }
    };
    return (
        <div
            onClick={() => onExpand(contact)}
            className="p-4 rounded-2xl border border-[rgba(174,194,228,0.6)] bg-white/90 hover:border-[rgba(120,178,245,0.75)] hover:bg-white cursor-pointer transition-all shadow-[0_24px_52px_-34px_rgba(143,165,255,0.35)]"
        >
            <div className="font-semibold truncate">
                {contact.first_name} {contact.last_name}
            </div>
            <div className="text-xs text-slate-500 truncate">{contact.email}</div>
            <div className={`mt-2 text-sm font-bold ${getStatusColor(contact.status || undefined)}`}>
                {contact.status || "unknown"}
            </div>
        </div>
    );
}
