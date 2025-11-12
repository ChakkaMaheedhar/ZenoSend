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

function parseExtras(s: string): string[] {
    return s.split(/[,\s;]+/).map(x => x.trim()).filter(Boolean);
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
                // fetch all; client separates valid vs risky
                const rows = (await getContacts()) as Contact[];
                setContacts(Array.isArray(rows) ? rows : []);
            } catch (e: any) {
                setErr(e.message ?? 'Failed to load contacts');
                setContacts([]); // UI still works with manual add
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const validOptions: Option[] = useMemo(
        () =>
            contacts
                .filter(c => c.status === 'valid')
                .map(c => ({
                    id: c.id,
                    label: c.email,
                    sub: [c.first_name, c.last_name].filter(Boolean).join(' ') || undefined,
                })),
        [contacts]
    );

    const riskyOptions: Option[] = useMemo(
        () =>
            contacts
                .filter(c => c.status === 'risky')
                .map(c => ({
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

    type RecipientKey = 'to' | 'cc' | 'bcc';
    const recipientConfigs: Array<{
        key: RecipientKey;
        label: string;
        selected: Set<number>;
        setSelected: React.Dispatch<React.SetStateAction<Set<number>>>;
        extra: string;
        setExtra: React.Dispatch<React.SetStateAction<string>>;
    }> = [
            { key: 'to', label: 'To', selected: toSel, setSelected: setToSel, extra: toExtra, setExtra: setToExtra },
            { key: 'cc', label: 'CC', selected: ccSel, setSelected: setCcSel, extra: ccExtra, setExtra: setCcExtra },
            { key: 'bcc', label: 'BCC', selected: bccSel, setSelected: setBccSel, extra: bccExtra, setExtra: setBccExtra },
        ];

    const [activeRecipient, setActiveRecipient] = useState<RecipientKey>('to');
    const [riskView, setRiskView] = useState<'valid' | 'risky'>('valid');
    const [searchTerm, setSearchTerm] = useState('');
    const [quickAdd, setQuickAdd] = useState('');

    useEffect(() => {
        setSearchTerm('');
        setQuickAdd('');
    }, [activeRecipient, riskView]);

    const activeConfig = recipientConfigs.find(r => r.key === activeRecipient)!;
    const activeOptions = riskView === 'valid' ? validOptions : riskyOptions;

    const filteredOptions = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        if (!q) return activeOptions;
        return activeOptions.filter(
            opt =>
                opt.label.toLowerCase().includes(q) ||
                (opt.sub ? opt.sub.toLowerCase().includes(q) : false)
        );
    }, [activeOptions, searchTerm]);

    function toggleActive(id: number) {
        toggle(activeConfig.setSelected, id);
    }

    function commitQuickAdd() {
        const email = quickAdd.trim();
        if (!email) return;
        if (!/^\S+@\S+\.\S+$/.test(email)) return;
        const existing = parseExtras(activeConfig.extra);
        if (!existing.includes(email)) {
            const next = existing.length ? `${activeConfig.extra.replace(/\s+$/, '')}, ${email}` : email;
            activeConfig.setExtra(next);
        }
        setQuickAdd('');
    }

    const extraCount = parseExtras(activeConfig.extra).length;

    const summary = recipientConfigs.map(cfg => ({
        key: cfg.key,
        label: cfg.label,
        selectedCount: cfg.selected.size,
        extraCount: parseExtras(cfg.extra).length,
    }));

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
        <div className="container mx-auto p-6 max-w-6xl space-y-6">
            <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-slate-700">Compose Campaign</h1>
                <p className="text-sm text-slate-500">
                    Choose recipients from your validated list, optionally include risky contacts, and craft your message.
                </p>
            </div>

            <form
                onSubmit={onSend}
                className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
            >
                <section className="card p-6 space-y-5">
                    <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-1">
                            <div className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
                                From
                            </div>
                            <input
                                className="input w-full"
                                type="email"
                                value={fromEmail}
                                onChange={e => setFromEmail(e.target.value)}
                                placeholder="you@company.com"
                                required
                            />
                        </div>
                        <div className="space-y-1">
                            <div className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
                                Subject
                            </div>
                            <input
                                className="input w-full"
                                value={subject}
                                onChange={e => setSubject(e.target.value)}
                                placeholder="Launch update for Q4"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
                            Plain text body
                        </div>
                        <textarea
                            className="input w-full"
                            rows={10}
                            value={textBody}
                            onChange={e => setTextBody(e.target.value)}
                            placeholder="Write your message..."
                        />
                    </div>

                    <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                            type="checkbox"
                            checked={validateExtras}
                            onChange={e => setValidateExtras(e.target.checked)}
                        />
                        Validate typed extra emails before sending
                    </label>
                </section>

                <section className="card p-6 space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {summary.map(s => {
                            const isActive = activeRecipient === s.key;
                            return (
                                <button
                                    key={s.key}
                                    type="button"
                                    onClick={() => setActiveRecipient(s.key)}
                                    className={`rounded-2xl border px-4 py-3 text-left transition-all ${isActive
                                        ? 'border-emerald-400 bg-white shadow-[0_18px_40px_-28px_rgba(93,178,255,0.45)]'
                                        : 'border-[rgba(190,206,236,0.7)] bg-white/70 hover:border-[rgba(120,178,245,0.8)] hover:bg-white'
                                        }`}
                                >
                                    <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
                                        {s.label}
                                        <span className="text-xs font-medium text-slate-500">
                                            {s.selectedCount} selected
                                        </span>
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">
                                        Extra addresses: {s.extraCount}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-600">
                            {activeConfig.label} recipients
                        </div>
                        <div className="inline-flex rounded-xl border border-[rgba(190,206,236,0.7)] bg-white overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setRiskView('valid')}
                                className={`px-3 py-1.5 text-sm font-medium transition ${riskView === 'valid'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'text-slate-500 hover:bg-slate-100'
                                    }`}
                            >
                                Valid
                            </button>
                            <button
                                type="button"
                                onClick={() => setRiskView('risky')}
                                className={`px-3 py-1.5 text-sm font-medium transition ${riskView === 'risky'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'text-slate-500 hover:bg-slate-100'
                                    }`}
                            >
                                Risky
                            </button>
                        </div>
                    </div>

                    {riskView === 'risky' && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                            Use caution—risky contacts are unverifiable or from accept-all domains. Monitor bounces before promoting them to valid.
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
                            Filter contacts
                        </div>
                        <input
                            className="input w-full"
                            placeholder="Type to filter by name or email"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="border border-[rgba(190,206,236,0.7)] rounded-2xl bg-white/80 h-64 overflow-auto divide-y divide-[rgba(190,206,236,0.35)]">
                        {filteredOptions.length === 0 ? (
                            <div className="px-4 py-6 text-sm text-slate-400">No contacts match your search.</div>
                        ) : (
                            filteredOptions.map(opt => {
                                const isChecked = activeConfig.selected.has(opt.id);
                                return (
                                    <label
                                        key={opt.id}
                                        className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition ${isChecked ? 'bg-emerald-50 border-l-4 border-l-emerald-400' : 'hover:bg-slate-100/60'
                                            }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => toggleActive(opt.id)}
                                        />
                                        <div className="leading-tight">
                                            <div className="font-mono text-sm text-slate-700">{opt.label}</div>
                                            {opt.sub && <div className="text-xs text-slate-500">{opt.sub}</div>}
                                        </div>
                                    </label>
                                );
                            })
                        )}
                    </div>

                    <div className="space-y-1">
                        <div className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
                            Quick add (press Enter)
                        </div>
                        <input
                            className="input w-full"
                            placeholder={`Add an email to ${activeConfig.label}`}
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
                    </div>

                    <div className="space-y-1">
                        <div className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
                            Extra emails for {activeConfig.label}
                        </div>
                        <textarea
                            className="input w-full"
                            rows={2}
                            placeholder="email1@example.com, email2@example.com"
                            value={activeConfig.extra}
                            onChange={e => activeConfig.setExtra(e.target.value)}
                        />
                        <div className="text-xs text-slate-400">
                            {extraCount} extra address{extraCount === 1 ? '' : 'es'} will be included
                        </div>
                    </div>
                </section>

                <div className="lg:col-span-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    {err ? (
                        <div className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-lg px-4 py-2">
                            {err}
                        </div>
                    ) : (
                        <div className="text-sm text-slate-500">
                            Total recipients (selected + extras): <span className="font-semibold text-slate-700">{totalRecipients}</span>
                        </div>
                    )}
                    <button
                        type="submit"
                        className="btn px-6"
                        disabled={sending || !fromEmail || !subject}
                    >
                        {sending ? 'Sending…' : 'Send Campaign'}
                    </button>
                </div>
            </form>
        </div>
    );
}
