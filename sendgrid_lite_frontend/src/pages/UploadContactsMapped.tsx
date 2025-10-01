import React, { useState } from 'react';
import { apiPreview, apiCommit } from '../api';

const TARGETS = [
    { key: 'email', label: 'Email *' },
    { key: 'first_name', label: 'First name' },
    { key: 'last_name', label: 'Last name' },
    { key: 'company', label: 'Company' },
    { key: 'website', label: 'Website' },
    { key: 'linkedin', label: 'LinkedIn' },
    { key: 'phone', label: 'Phone' },
    { key: 'role', label: 'Role' },
    { key: 'name', label: 'Full name (auto-split)' },
];

export default function UploadContactsMapped() {
    const [file, setFile] = useState<File | null>(null);
    const [uploadId, setUploadId] = useState('');
    const [columns, setColumns] = useState<string[]>([]);
    const [sample, setSample] = useState<any[]>([]);
    const [mapping, setMapping] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ created: number; updated: number; validated: number } | null>(null);

    function guessMap(cols: string[]) {
        const g: Record<string, string> = {};
        for (const col of cols) {
            const c = col.toLowerCase();
            if (c.includes('email')) g.email = col;
            else if (c.includes('first')) g.first_name = col;
            else if (c.includes('last')) g.last_name = col;
            else if (c.includes('full name') || c === 'name') g.name = col;
            else if (c.includes('company')) g.company = col;
            else if (c.includes('website') || c.includes('url') || c.includes('domain')) g.website = col;
            else if (c.includes('linkedin')) g.linkedin = col;
            else if (c.includes('phone') || c.includes('mobile')) g.phone = col;
            else if (c.includes('role') || c.includes('title') || c.includes('designation')) g.role = col;
        }
        return g;
    }

    async function handlePreview() {
        if (!file) {
            setError('Choose a file to begin');
            return;
        }
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            const data = await apiPreview(file);
            setUploadId(data.upload_id);
            setColumns(data.columns);
            setSample(data.sample);
            setMapping(guessMap(data.columns));
        } catch (e: any) {
            setError(e.message || 'Preview failed');
        } finally {
            setBusy(false);
        }
    }

    async function handleImport() {
        if (!uploadId) {
            setError('Preview first, then import.');
            return;
        }
        if (!mapping.email) {
            setError('Map the Email column.');
            return;
        }
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            // Validate is forced ON by product requirement
            const r = await apiCommit(uploadId, mapping, true);
            setResult(r);
            // clear staged preview
            setUploadId('');
            setColumns([]);
            setSample([]);
        } catch (e: any) {
            setError(e.message || 'Import failed');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="container mx-auto p-6 max-w-6xl">
            <header className="mb-6">
                <h1 className="text-xl font-semibold">Bulk Upload & Map Contacts</h1>
                <p className="text-sm text-slate-400">
                    Upload CSV, Excel, TSV/TXT, or PDF (tables). Then map your columns to our fields.
                    Email is required. Validation runs automatically after import.
                </p>
            </header>

            {/* Step 1 */}
            <div className="card p-4 mb-4">
                <div className="text-sm font-medium mb-2">Step 1: Choose a file</div>
                <div className="flex gap-3 items-center">
                    <input
                        type="file"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                        className="block text-sm"
                    />
                    <button className="btn" onClick={handlePreview} disabled={busy}>
                        {busy ? 'Working…' : 'Preview'}
                    </button>
                </div>
                {error && <div className="text-red-400 text-sm mt-3">{error}</div>}
            </div>

            {/* Step 2 */}
            {columns.length > 0 && (
                <div className="card p-4 mb-4">
                    <div className="text-sm font-medium mb-3">Step 2: Map columns</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {TARGETS.map((t) => (
                            <div key={t.key}>
                                <div className="text-xs opacity-70 mb-1">{t.label}</div>
                                <select
                                    className="input w-full"
                                    value={mapping[t.key] ?? ''}
                                    onChange={(e) =>
                                        setMapping((m) => ({ ...m, [t.key]: e.target.value }))
                                    }
                                >
                                    <option value="">— (skip)</option>
                                    {columns.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>

                    {/* Sticky action bar */}
                    <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-4">
                        <div className="text-xs text-slate-400">
                            Validation after import: <span className="text-emerald-300 font-medium">ON</span>
                        </div>
                        <button className="btn" onClick={handleImport} disabled={busy}>
                            {busy ? 'Importing…' : 'Import & Validate'}
                        </button>
                    </div>
                </div>
            )}

            {/* Preview rows */}
            {columns.length > 0 && (
                <div className="card p-0 overflow-hidden">
                    <div className="px-4 py-3 text-sm font-medium border-b border-slate-800">
                        Preview (first rows)
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-900/60">
                                <tr>
                                    {columns.map((c) => (
                                        <th key={c} className="px-3 py-2 text-left text-[13px] uppercase tracking-wide">
                                            {c}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sample.map((row, i) => (
                                    <tr key={i} className="border-t border-slate-800/60">
                                        {columns.map((c) => (
                                            <td key={c} className="px-3 py-2">
                                                {row[c]}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Result */}
            {result && (
                <div className="card p-4 mt-4">
                    <div className="text-sm">
                        <b>Import complete:</b>{' '}
                        <span className="text-emerald-300">{result.created}</span> created,{' '}
                        <span className="text-indigo-300">{result.updated}</span> updated,{' '}
                        <span className="text-amber-300">{result.validated}</span> validated.
                    </div>
                </div>
            )}
        </div>
    );
}
