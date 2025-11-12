import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth";

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
    const { pathname, hash } = useLocation();
    const here = (hash || pathname).replace(/^#/, "") || "/";
    const isActive = (to === "/" && here === "/") || here.startsWith(to);
    return (
        <Link
            to={to}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                    ? "bg-[linear-gradient(120deg,rgba(93,242,214,0.95),rgba(143,165,255,0.95))] text-[#041427] shadow-[0_16px_38px_-18px_rgba(143,165,255,0.45)]"
                    : "bg-white/70 text-slate-600 hover:bg-white hover:text-[#2c4baa] border border-transparent hover:border-[rgba(176,196,236,0.6)]"
            }`}
        >
            {children}
        </Link>
    );
}

export default function Header() {
    const { user, logout } = useAuth();
    const isAdmin = user?.role === "admin";

    return (
        <header className="w-full border-b border-[rgba(174,194,228,0.5)] bg-white/90 backdrop-blur-xl sticky top-0 z-50 shadow-[0_24px_60px_-32px_rgba(143,165,255,0.35)]">
            <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-4">
                {/* left: brand + nav */}
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700 mr-3 tracking-wide">SendGrid-Lite</span>
                    <nav className="flex items-center gap-2">
                        <NavLink to="/">Dashboard</NavLink>
                        <NavLink to="/upload">Upload CSV</NavLink>
                        <NavLink to="/validate">Validate Email</NavLink>
                        <NavLink to="/contacts">Contacts</NavLink>
                        {/* per your request: HIDE compose for admins */}
                        {!isAdmin && <NavLink to="/compose">Compose Campaign</NavLink>}
                        {/* admin-only menu */}
                        {isAdmin && <NavLink to="/admin/users">Admin · Users</NavLink>}
                    </nav>
                </div>

                {/* right: user + logout */}
                <div className="flex items-center gap-3">
                    {user && (
                        <span className="text-sm text-gray-300 hidden sm:inline">
                            {user.email} · {user.role}
                        </span>
                    )}
                    <button
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white/70 text-slate-600 hover:bg-white hover:text-[#2c4baa] border border-transparent hover:border-[rgba(176,196,236,0.6)] transition-all"
                        onClick={logout}
                        aria-label="Log out"
                    >
                        Logout
                    </button>
                </div>
            </div>
        </header>
    );
}
