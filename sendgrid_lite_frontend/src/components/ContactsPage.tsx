// src/components/ContactsPage.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
    ContactRow,
    getContacts,
    validateOne,
    updateContact,
    createContact, // added
} from '../api';
import { useAuth } from '../auth';

type EditState = Partial<{
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string;
    linkedin_url: string | null;
    company: string | null;
    website: string | null;
    phone: string | null;
    role: string | null;
    status: string | null;
}>;

export default function ContactsPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const [rows, setRows] = useState<ContactRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // filters/search
    const [status, setStatus] =
        useState<'all' | 'new' | 'valid' | 'invalid' | 'risky' | 'unknown'>('all');
    const [q, setQ] = useState('');

    // inline busy flags
    const [valBusy, setValBusy] = useState(false);
    const [saving, setSaving] = useState(false);

    // edit modal
    const [showEdit, setShowEdit] = useState(false);
    const [edit, setEdit] = useState<EditState>({});

    // ---------- SINGLE-ADD (restored) ----------
    const [fn, setFn] = useState('');
    const [ln, setLn] = useState('');
    const [email, setEmail] = useState('');
    const [linkedin, setLinkedin] = useState('');
    const smtpAlwaysOn = true;
    const [valPreview, setValPreview] = useState<{
        status: string;
        reason?: string | null;
        provider?: string | null;
    } | null>(null);
    // ------------------------------------------

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            const data = await getContacts(
                status === 'all' ? undefined : status,
                q || undefined
            );
            setRows(data);
        } catch (e: any) {
            setErr(e.message || 'Failed to load contacts');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line
    }, []);

    const filtered = useMemo(() => rows, [rows]);

    function badge(s?: string | null) {
        const base = 'px-2 py-[2px] rounded text-xs';
        switch (s) {
            case 'valid':
                return `${base} bg-emerald-600/20 text-emerald-300`;
            case 'invalid':
                return `${base} bg-red-600/20 text-red-300`;
            case 'risky':
                return `${base} bg-amber-500/20 text-amber-300`;
            default:
                return `${base} bg-slate-700/40 text-slate-300`;
        }
    }

    async function revalidate(addr: string) {
        setErr(null);
        setValBusy(true);
        try {
            await validateOne(addr);
            await load();
        } catch (e: any) {
            setErr(e.message || 'Validation failed');
        } finally {
            setValBusy(false);
        }
    }

    function openEdit(r: any) {
        setEdit({
            id: r.id,
            email: r.email,
            first_name: r.first_name ?? '',
            last_name: r.last_name ?? '',
            linkedin_url: r.linkedin_url ?? '',
            company: (r as any).company ?? '',
            website: (r as any).website ?? '',
            phone: (r as any).phone ?? '',
            role: (r as any).role ?? '',
            status: r.status ?? 'new',
        });
        setShowEdit(true);
    }

    async function saveEdit() {
        if (!edit.id) return;
        setSaving(true);
        setErr(null);
        try {
            await updateContact(edit.id, {
                first_name: edit.first_name ?? undefined,
                last_name: edit.last_name ?? undefined,
                linkedin_url: edit.linkedin_url ?? undefined,
                company: edit.company ?? undefined,
                website: edit.website ?? undefined,
                phone: edit.phone ?? undefined,
                role: edit.role ?? undefined,
                status: edit.status ?? undefined,
            });
            setShowEdit(false);
            await load();
        } catch (e: any) {
            setErr(e.message || 'Failed to save contact');
        } finally {
            setSaving(false);
        }
    }

    // ---------- SINGLE-ADD handlers ----------
    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        try {
            if (!email.trim()) throw new Error('Email is required');
            await createContact({
                first_name: fn || undefined,
                last_name: ln || undefined,
                email: email.trim().toLowerCase(),
                linkedin_url: linkedin || undefined,
            });
            setFn(''); setLn(''); setEmail(''); setLinkedin(''); setValPreview(null);
            await load();
        } catch (e: any) {
            setErr(e.message || 'Failed to create contact');
        }
    }

    async function handleValidateAndSave(e: React.FormEvent) {
        e.preventDefault();
        if (!email.trim()) { setErr('Email is required'); return; }
        setErr(null);
        setValBusy(true);
        try {
            const addr = email.trim().toLowerCase();
            const r = await validateOne(addr); // SMTP probe always ON
            setValPreview({ status: r.status, reason: r.reason ?? null, provider: r.provider ?? null });
            await createContact({
                first_name: fn || undefined,
                last_name: ln || undefined,
                email: addr,
                linkedin_url: linkedin || undefined,
            });
            setFn(''); setLn(''); setEmail(''); setLinkedin('');
            await load();
        } catch (e: any) {
            setErr(e.message || 'Validate & Save failed');
        } finally {
            setValBusy(false);
        }
    }
    // -----------------------------------------

    return (
        <div className="container mx-auto p-6 max-w-7xl">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-xl font-semibold">Contacts</h1>
                <p className="text-sm text-slate-400">
                    Manage your list, edit fields, and re-validate addresses via SMTP probe.
                </p>
            </div>

            {/* Single-add form (restored) */}
            <form onSubmit={handleSave} className="card p-4 mb-6 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <input className="input" placeholder="First name" value={fn} onChange={e => setFn(e.target.value)} />
                    <input className="input" placeholder="Last name" value={ln} onChange={e => setLn(e.target.value)} />
                    <input className="input" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
                    <input className="input" placeholder="LinkedIn URL" value={linkedin} onChange={e => setLinkedin(e.target.value)} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button type="submit" className="btn">Save</button>
                    <button type="button" className="btn" onClick={handleValidateAndSave} disabled={valBusy}>
                        {valBusy ? 'Validating…' : 'Validate & Save'}
                    </button>
                    <label className="flex items-center gap-2 text-sm opacity-80">
                        <input type="checkbox" checked={smtpAlwaysOn} disabled />
                        Use SMTP probe (always on)
                    </label>
                    {valPreview && (
                        <span
                            className={`ml-2 text-sm px-2 py-[2px] rounded ${valPreview.status === 'valid'
                                ? 'bg-emerald-600/20 text-emerald-300'
                                : valPreview.status === 'risky'
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : valPreview.status === 'invalid'
                                        ? 'bg-red-600/20 text-red-300'
                                        : 'bg-slate-600/20 text-slate-300'
                                }`}
                        >
                            {valPreview.status}
                            {valPreview.provider ? ` · ${valPreview.provider}` : ''}
                            {valPreview.reason ? ` · ${valPreview.reason}` : ''}
                        </span>
                    )}
                </div>
                {err && <div className="text-red-400 text-sm">{err}</div>}
            </form>

            {/* Filters */}
            <div className="card p-4 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div>
                        <div className="text-xs opacity-70 mb-1">Filter by status</div>
                        <select
                            className="input w-full"
                            value={status}
                            onChange={(e) => setStatus(e.target.value as any)}
                        >
                            <option value="all">all</option>
                            <option value="new">new</option>
                            <option value="valid">valid</option>
                            <option value="invalid">invalid</option>
                            <option value="risky">risky</option>
                            <option value="unknown">unknown</option>
                        </select>
                    </div>
                    <div className="md:col-span-2">
                        <div className="text-xs opacity-70 mb-1">
                            Search (name/email/link/phone/etc)
                        </div>
                        <div className="flex gap-2">
                            <input
                                className="input w-full"
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder="e.g. emily@, /in/john…, +1 555…"
                            />
                            <button className="btn" onClick={load}>
                                Search
                            </button>
                            <button
                                className="btn"
                                onClick={() => {
                                    setQ('');
                                    setStatus('all');
                                    load();
                                }}
                            >
                                Refresh
                            </button>
                        </div>
                    </div>
                </div>
                {err && <div className="text-red-400 text-sm mt-3">{err}</div>}
            </div>

            {/* Table */}
            <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-900/60 sticky top-0 z-10">
                            <tr>
                                <Th>First</Th>
                                <Th>Last</Th>
                                <Th>Email</Th>
                                <Th>LinkedIn</Th>
                                <Th>Company</Th>
                                <Th>Website</Th>
                                <Th>Phone</Th>
                                <Th>Role</Th>
                                <Th>Status</Th>
                                {isAdmin && <Th>Owner</Th>}
                                <Th className="text-right">Actions</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr>
                                    <td className="px-4 py-6 text-slate-400" colSpan={isAdmin ? 12 : 11}>
                                        Loading…
                                    </td>
                                </tr>
                            )}
                            {!loading && filtered.length === 0 && (
                                <tr>
                                    <td className="px-4 py-6 text-slate-400" colSpan={isAdmin ? 12 : 11}>
                                        No contacts.
                                    </td>
                                </tr>
                            )}
                            {filtered.map((r) => (
                                <tr key={r.id} className="border-t border-slate-800/60">
                                    <Td>{r.first_name || '—'}</Td>
                                    <Td>{r.last_name || '—'}</Td>
                                    <Td>
                                        <div className="font-mono truncate max-w-[240px]" title={r.email}>
                                            {r.email}
                                        </div>
                                    </Td>
                                    <Td className="max-w-[220px]">
                                        {r.linkedin_url ? (
                                            <a
                                                className="underline opacity-80 truncate inline-block max-w-[220px]"
                                                href={r.linkedin_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                title={r.linkedin_url}
                                            >
                                                {r.linkedin_url}
                                            </a>
                                        ) : (
                                            '—'
                                        )}
                                    </Td>
                                    <Td>{(r as any).company || '—'}</Td>
                                    <Td>
                                        {(r as any).website ? (
                                            <a
                                                className="underline opacity-80"
                                                href={(r as any).website.startsWith('http') ? (r as any).website : `https://${(r as any).website}`}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                {(r as any).website}
                                            </a>
                                        ) : (
                                            '—'
                                        )}
                                    </Td>
                                    <Td>{(r as any).phone || '—'}</Td>
                                    <Td>{(r as any).role || '—'}</Td>
                                    <Td>
                                        <span className={badge(r.status)}>{r.status || '—'}</span>
                                    </Td>
                                    {isAdmin && <Td>{r.owner_email || '—'}</Td>}
                                    <Td className="text-right">
                                        <div className="flex gap-2 justify-end">
                                            <button className="btn btn-small" onClick={() => openEdit(r)}>
                                                Edit
                                            </button>
                                            <button
                                                className="btn btn-small"
                                                onClick={() => revalidate(r.email)}
                                                disabled={valBusy}
                                            >
                                                Re-validate
                                            </button>
                                        </div>
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Edit Modal */}
            {showEdit && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
                        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                            <div className="font-semibold">Edit Contact</div>
                            <button className="btn btn-small" onClick={() => setShowEdit(false)}>
                                Close
                            </button>
                        </div>
                        <div className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <Input
                                    label="First name"
                                    value={edit.first_name ?? ''}
                                    onChange={(v) => setEdit((e) => ({ ...e, first_name: v }))}
                                />
                                <Input
                                    label="Last name"
                                    value={edit.last_name ?? ''}
                                    onChange={(v) => setEdit((e) => ({ ...e, last_name: v }))}
                                />
                                <Input label="Email" value={edit.email || ''} disabled />
                                <Input
                                    label="LinkedIn URL"
                                    value={edit.linkedin_url ?? ''}
                                    onChange={(v) => setEdit((e) => ({ ...e, linkedin_url: v }))}
                                />
                                <Input
                                    label="Company"
                                    value={edit.company ?? ''}
                                    onChange={(v) => setEdit((e) => ({ ...e, company: v }))}
                                />
                                <Input
                                    label="Website"
                                    value={edit.website ?? ''}
                                    onChange={(v) => setEdit((e) => ({ ...e, website: v }))}
                                />
                                <Input
                                    label="Phone"
                                    value={edit.phone ?? ''}
                                    onChange={(v) => setEdit((e) => ({ ...e, phone: v }))}
                                />
                                <Input
                                    label="Role"
                                    value={edit.role ?? ''}
                                    onChange={(v) => setEdit((e) => ({ ...e, role: v }))}
                                />
                                <div>
                                    <div className="text-xs opacity-70 mb-1">Status</div>
                                    <select
                                        className="input w-full"
                                        value={edit.status ?? 'new'}
                                        onChange={(e) =>
                                            setEdit((x) => ({ ...x, status: e.target.value }))
                                        }
                                    >
                                        <option value="new">new</option>
                                        <option value="valid">valid</option>
                                        <option value="invalid">invalid</option>
                                        <option value="risky">risky</option>
                                        <option value="unknown">unknown</option>
                                    </select>
                                </div>
                            </div>

                            {err && <div className="text-red-400 text-sm mt-3">{err}</div>}

                            <div className="flex justify-end gap-2 mt-4">
                                <button className="btn btn-ghost" onClick={() => setShowEdit(false)}>
                                    Cancel
                                </button>
                                <button className="btn" onClick={saveEdit} disabled={saving}>
                                    {saving ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ---------- small presentational helpers ---------- */

function Th(props: React.HTMLAttributes<HTMLTableCellElement>) {
    return (
        <th
            {...props}
            className={`px-4 py-3 text-left text-[13px] font-semibold uppercase tracking-wide ${props.className || ''
                }`}
        />
    );
}
function Td(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
    return (
        <td {...props} className={`px-4 py-3 align-top ${props.className || ''}`} />
    );
}

function Input({
    label,
    value,
    onChange,
    disabled,
}: {
    label: string;
    value: string;
    onChange?: (v: string) => void;
    disabled?: boolean;
}) {
    return (
        <div>
            <div className="text-xs opacity-70 mb-1">{label}</div>
            <input
                className="input w-full"
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                disabled={disabled}
            />
        </div>
    );
}
