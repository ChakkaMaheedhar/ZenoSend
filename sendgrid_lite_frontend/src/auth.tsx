import React, { createContext, useContext, useState, useEffect } from 'react';

type User = { email: string; role: 'user' | 'admin' } | null;

type AuthContextType = {
    user: User;
    initializing: boolean;
    login: (email: string, pw: string) => Promise<void>;
    logout: () => void;
};

const AuthCtx = createContext<AuthContextType>({
    user: null,
    initializing: true,
    login: async () => { },
    logout: () => { },
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User>(null);
    const [initializing, setInitializing] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem('token');
        const role = localStorage.getItem('role') as 'user' | 'admin' | null;
        const email = localStorage.getItem('email');
        if (token && role && email) setUser({ email, role });
        setInitializing(false);
    }, []);

    // ✅ Works whether api.ts exports login directly or as default
    async function login(email: string, password: string) {
        const api: any = await import('./api'); // `any` avoids TS conflict
        const apiLogin =
            api.login ||             // named export
            api.default?.login ||    // default export object with login
            api.default;             // default export function

        if (typeof apiLogin !== 'function') {
            throw new Error('API login function not found');
        }

        const r = await apiLogin(email, password);
        localStorage.setItem('token', r.access_token);
        localStorage.setItem('role', r.role);
        localStorage.setItem('email', r.email);
        setUser({ email: r.email, role: r.role });
    }

    function logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('email');
        setUser(null);
    }

    return (
        <AuthCtx.Provider value={{ user, initializing, login, logout }}>
            {children}
        </AuthCtx.Provider>
    );
};

export const useAuth = () => useContext(AuthCtx);
