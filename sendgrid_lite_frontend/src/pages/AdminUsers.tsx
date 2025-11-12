import React, { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { Navigate, useNavigate } from "react-router-dom";
import {
    adminListUsers,
    adminCreateUser,
    getContacts,
    type AppUser,
    type ContactRow,
} from "../api";

export default function AdminUsersPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    if (user?.role !== "admin") return <Navigate to="/" replace />;

    const [rows, setRows] = useState<AppUser[]>([]);
    const [contacts, setContacts] = useState<ContactRow[]>([]);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState<"user" | "admin">("user");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    async function load() {
        try {
            setErr(null);
            setLoading(true);
            const [userData, contactData] = await Promise.all([
                adminListUsers(),
                getContacts(),
            ]);
            setRows(Array.isArray(userData) ? userData : []);
            setContacts(Array.isArray(contactData) ? contactData : []);
        } catch (e: any) {
            setErr(e.message || "Failed to load users");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    async function onCreate(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
            await adminCreateUser({ email, password, role });
            setEmail("");
            setPassword("");
            setRole("user");
            await load();
        } catch (e: any) {
            setErr(e.message || "Failed to create user");
        } finally {
            setBusy(false);
        }
    }

    // --- Count contacts per recruiter ---
    const contactCounts = (Array.isArray(contacts) ? contacts : []).reduce(
        (acc, c) => {
            const owner = c.owner_email || "Unknown";
            acc[owner] = (acc[owner] || 0) + 1;
            return acc;
        },
        {} as Record<string, number>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <h1 className="text-2xl font-semibold">Admin · Recruiters Overview</h1>

            {/* --- Create Recruiter Form --- */}
            <form onSubmit={onCreate} className="space-y-3 card">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input
                        className="input"
                        placeholder="email@domain.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                    <input
                        className="input"
                        type="password"
                        placeholder="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                    <select
                        className="input"
                        value={role}
                        onChange={(e) => setRole(e.target.value as "user" | "admin")}
                    >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                    </select>
                </div>
                {err && <div className="text-red-400 text-sm">{err}</div>}
                <button className="btn" disabled={busy}>
                    {busy ? "Creating..." : "Create User"}
                </button>
            </form>

            {/* --- Recruiter Cards --- */}
            {loading ? (
                <div className="text-slate-500 text-center py-10">Loading users…</div>
            ) : !rows.length ? (
                <div className="text-slate-500 text-center py-10">No users yet.</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {rows.map((u) => (
                        <div
                            key={u.id}
                            className="p-4 rounded-2xl border border-[rgba(174,194,228,0.6)] bg-white/90 hover:border-[rgba(120,178,245,0.75)] hover:bg-white transition-all shadow-[0_24px_52px_-34px_rgba(143,165,255,0.35)]"
                        >
                            <div className="font-mono text-sm truncate text-slate-700">{u.email}</div>
                            <div className="text-xs text-slate-500 mt-1">role: {u.role}</div>
                            <div className="mt-2 text-sm text-slate-600">
                                Contacts:{" "}
                                <span className="font-semibold text-emerald-500">
                                    {contactCounts[u.email] || 0}
                                </span>
                            </div>

                            <button
                                className="btn mt-4 w-full text-sm"
                                onClick={() =>
                                    navigate("/contacts", { state: { scrollTo: u.email } })
                                }
                            >
                                View Contacts
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
