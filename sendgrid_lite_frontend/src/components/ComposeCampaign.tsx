// src/components/ComposeCampaign.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { composeSend, getContacts } from '../api';

type Contact = {
    id: number;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
    status: string;
};

type Option = { id: number; label: string; sub?: string };

function useDebounced<T>(value: T, delay = 250) {
    const [v, setV] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setV(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return v;
}

function parseExtras(s: string): string[] {
    return s.split(/[,\s;]+/).map(x => x.trim()).filter(Boolean);
}

function BoxList({
    title,
    options,
    selected,
    onToggle,
    extraValue,
    onExtraChange,
}: {
    title: string;
    options: Option[];
    selected: Set<number>;
    onToggle: (id: number) => void;
    extraValue: string;
    onExtraChange: (s: string) => void;
}) {
    const [q, setQ] = useState('');
    const dq = useDebounced(q);
    const [quickAdd, setQuickAdd] = useState('');

    const filtered = useMemo(() => {
        const qq = dq.toLowerCase();
        return !qq
            ? options
            : options.filter(
                o =>
                    o.label.toLowerCase().includes(qq) ||
                    (o.sub ? o.sub.toLowerCase().includes(qq) : false)
            );
    }, [options, dq]);

    const roleLabel = title.split(' ')[0]; // "To" | "CC" | "BCC"

    // Commit the address in the quick-add box into the "extra emails" field
    function commitQuickAdd() {
        const email = quickAdd.trim();
        if (!email) return;
        if (!/^\S+@\S+\.\S+$/.test(email)) return; // light format check
        const existing = parseExtras(extraValue);
        if (!existing.includes(email)) {
            const next = existing.length ? `${extraValue.replace(/\s+$/, '')}, ${email}` : email;
            onExtraChange(next);
        }
        setQuickAdd('');
    }

    return (
        <div className="card p-3 space-y-3">
            <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs opacity-70">{selected.size} selected</div>
            </div>

            {/* Quick add (no + button; Enter or blur commits) */}
            <input
                className="input w-full"
                placeholder={`Add email to ${roleLabel} (not in list)`}
                value={quickAdd}
                onChange={e => setQuickAdd(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        commitQuickAdd();
                    }
                }}
                onBlur={commitQuickAdd}
            />

            <input
                className="input w-full"
                placeholder="Filter…"
                value={q}
                onChange={e => setQ(e.target.value)}
            />

            <div className="border border-slate-800/60 rounded overflow-hidden">
                <div className="max-h-48 overflow-auto divide-y divide-slate-800/60">
                    {filtered.map(o => (
                        <label
                            key={o.id}
                            className="flex items-center gap-3 px-3 py-2 hover:bg-slate-900/40 cursor-pointer"
                        >
                            <input
                                type="checkbox"
                                checked={selected.has(o.id)}
                                onChange={() => onToggle(o.id)}
                            />
                            <div className="leading-tight">
                                <div className="font-mono text-sm">{o.label}</div>
                                {o.sub && <div className="text-xs opacity-70">{o.sub}</div>}
                            </div>
                        </label>
                    ))}
                    {filtered.length === 0 && (
                        <div className="px-3 py-3 text-sm opacity-60">No matches.</div>
                    )}
                </div>
            </div>

            <div className="space-y-1">
                <div className="text-xs opacity-70">Extra emails (comma/space separated)</div>
                <input
                    className="input w-full"
                    placeholder="email1@example.com, email2@example.com"
                    value={extraValue}
                    onChange={e => onExtraChange(e.target.value)}
                />
            </div>
        </div>
    );
}

export default function ComposeCampaign() {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [sending, setSending] = useState(false);

    // form
    const [fromEmail, setFromEmail] = useState('');
    const [subject, setSubject] = useState('');
    const [textBody, setTextBody] = useState('');

    // selections
    const [toSel, setToSel] = useState<Set<number>>(new Set());
    const [ccSel, setCcSel] = useState<Set<number>>(new Set());
    const [bccSel, setBccSel] = useState<Set<number>>(new Set());

    // extra typed emails
    const [toExtra, setToExtra] = useState('');
    const [ccExtra, setCcExtra] = useState('');
    const [bccExtra, setBccExtra] = useState('');

    const [validateExtras, setValidateExtras] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                // fetch all; client-filter to 'valid' to avoid /contacts?status=valid 502s
                const rows = (await getContacts()) as Contact[];
                setContacts(Array.isArray(rows) ? rows.filter(r => r.status === 'valid') : []);
            } catch (e: any) {
                setErr(e.message ?? 'Failed to load contacts');
                setContacts([]); // UI still works with manual add
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const options: Option[] = useMemo(
        () =>
            contacts.map(c => ({
                id: c.id,
                label: c.email,
                sub: [c.first_name, c.last_name].filter(Boolean).join(' ') || undefined,
            })),
        [contacts]
    );

    const totalRecipients =
        toSel.size +
        ccSel.size +
        bccSel.size +
        parseExtras(toExtra).length +
        parseExtras(ccExtra).length +
        parseExtras(bccExtra).length;

    function toggle(setter: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) {
        setter(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    async function onSend(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        setSending(true);

        try {
            if (!fromEmail || !subject) {
                setErr('From and Subject are required');
                return;
            }

            const payload = {
                name: 'Quick Send',
                from_email: fromEmail,
                subject,
                text_body: textBody || undefined,
                html_body: undefined, // per your request
                to_ids: Array.from(toSel),
                cc_ids: Array.from(ccSel),
                bcc_ids: Array.from(bccSel),
                to_extra: parseExtras(toExtra),
                cc_extra: parseExtras(ccExtra),
                bcc_extra: parseExtras(bccExtra),
                validate_extras: validateExtras,
            };

            const r = await composeSend(payload);

            alert(
                `Campaign ${r.campaign_id}\nSelected: ${r.selected}\nValid: ${r.valid_recipients}\nEnqueued: ${r.enqueued}`
            );

            // reset
            setSubject('');
            setTextBody('');
            setToSel(new Set());
            setCcSel(new Set());
            setBccSel(new Set());
            setToExtra('');
            setCcExtra('');
            setBccExtra('');
        } catch (e: any) {
            setErr(e?.message ?? 'Failed to send');
        } finally {
            setSending(false);
        }
    }

    if (loading) return <div className="p-6">Loading contacts…</div>;

    return (
        <div className="container mx-auto p-6 max-w-6xl">
            <div className="card p-4 mb-6">
                <div className="text-lg font-semibold mb-1">Compose Campaign</div>
                <div className="text-sm opacity-70">
                    Pick recipients from your valid contacts, or type extra email addresses.
                </div>
            </div>

            <form onSubmit={onSend} className="card p-4 space-y-6">
                {/* Header */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <div className="text-xs opacity-70 mb-1">From (you@company.com)</div>
                        <input
                            className="input w-full"
                            type="email"
                            value={fromEmail}
                            onChange={e => setFromEmail(e.target.value)}
                            placeholder="you@company.com"
                            required
                        />
                    </div>
                    <div>
                        <div className="text-xs opacity-70 mb-1">Subject</div>
                        <input
                            className="input w-full"
                            value={subject}
                            onChange={e => setSubject(e.target.value)}
                            placeholder="Subject"
                            required
                        />
                    </div>
                </div>

                {/* Recipient pickers */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <BoxList
                        title="To (Valid Contacts)"
                        options={options}
                        selected={toSel}
                        onToggle={id => toggle(setToSel, id)}
                        extraValue={toExtra}
                        onExtraChange={setToExtra}
                    />
                    <BoxList
                        title="CC (Valid Contacts)"
                        options={options}
                        selected={ccSel}
                        onToggle={id => toggle(setCcSel, id)}
                        extraValue={ccExtra}
                        onExtraChange={setCcExtra}
                    />
                    <BoxList
                        title="BCC (Valid Contacts)"
                        options={options}
                        selected={bccSel}
                        onToggle={id => toggle(setBccSel, id)}
                        extraValue={bccExtra}
                        onExtraChange={setBccExtra}
                    />
                </div>

                {/* Validate extras */}
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={validateExtras}
                        onChange={e => setValidateExtras(e.target.checked)}
                    />
                    Validate typed extra emails before sending
                </label>

                {/* Message */}
                <div>
                    <div className="text-xs opacity-70 mb-1">Plain Text</div>
                    <textarea
                        className="input w-full"
                        rows={10}
                        value={textBody}
                        onChange={e => setTextBody(e.target.value)}
                        placeholder="Enter your message here…"
                    />
                </div>

                {/* Footer */}
                {err && <div className="text-sm text-red-400">{err}</div>}
                <div className="flex items-center justify-between">
                    <div className="text-sm opacity-70">Total recipients: {totalRecipients}</div>
                    <button type="submit" className="btn" disabled={sending || !fromEmail || !subject}>
                        {sending ? 'Sending…' : 'Send Campaign'}
                    </button>
                </div>
            </form>
        </div>
    );
}
