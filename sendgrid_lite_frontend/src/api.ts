/* ------------------ Base Config ------------------ */
const API_BASE = import.meta.env.VITE_API_BASE || "";
const API_KEY = import.meta.env.VITE_API_KEY || "dev-token-change-me";

type FetchOpts = RequestInit & { json?: any };

function authHeader(): Record<string, string> {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ------------------ Core API Wrapper ------------------ */
export async function api(path: string, opts: FetchOpts = {}) {
  const headers: Record<string, string> = {
    "x-api-key": API_KEY,
    ...authHeader(),
    ...(opts.headers ? (opts.headers as Record<string, string>) : {}),
  };

  const url = `${API_BASE}${path}`;
  const hasJson = opts.json !== undefined;
  if (hasJson) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    ...opts,
    headers,
    body: hasJson ? JSON.stringify(opts.json) : opts.body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Login failed: ${errText}`);
  }

  return res.json();
}

/* ------------------ Contacts ------------------ */
export type ContactRow = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  linkedin_url?: string | null;
  company?: string | null;
  website?: string | null;
  phone?: string | null;
  role?: string | null;
  status?: string | null;
  reason?: string | null;
  provider?: string | null;
  owner_email?: string | null;
};

export const getContacts = (status?: string, q?: string) => {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  const qs = params.toString();
  return api(`/contacts${qs ? `?${qs}` : ""}`) as Promise<ContactRow[]>;
};

export const createContact = (payload: Partial<ContactRow> & { email: string }) =>
  api("/contacts", { method: "POST", json: payload });

export const updateContact = (id: number, payload: Partial<ContactRow>) =>
  api(`/contacts/${id}`, { method: "PATCH", json: payload });

export const deleteContact = (id: number) =>
  api(`/contacts/${id}`, { method: "DELETE" });

/* ✅ Flexible Validation Endpoint */
export const validateOne = (email: string, useSmtp = true) =>
  api(`/contacts/validate_one?use_smtp_probe=${useSmtp}`, {
    method: "POST",
    json: { email: email.trim().toLowerCase() },
  }) as Promise<{
    id: number;
    email: string;
    status: string;
    reason?: string | null;
    provider?: string | null;
    verdict: string;
  }>;

export const revalidateById = (id: number, useSmtp = true) =>
  api(`/contacts/${id}/revalidate?use_smtp_probe=${useSmtp}`, {
    method: "POST",
  }) as Promise<ContactRow>;

/* ------------------ Admin Users ------------------ */
export type AppUser = { id: number; email: string; role: "user" | "admin" };

export const adminListUsers = () =>
  api("/admin/users") as Promise<AppUser[]>;

export const adminCreateUser = (payload: {
  email: string;
  password: string;
  role: "user" | "admin";
}) =>
  api("/admin/users", { method: "POST", json: payload }) as Promise<AppUser>;

/* ------------------ Campaigns ------------------ */
export const createCampaign = (payload: any) =>
  api("/campaigns", { method: "POST", json: payload });

export const sendSelected = (campaignId: number, ids: number[]) =>
  api(`/campaigns/${campaignId}/send_selected`, {
    method: "POST",
    json: { contact_ids: ids },
  });

export const stats = (campaignId: number) =>
  api(`/campaigns/${campaignId}/stats`);

export const composeSend = (payload: any) =>
  api("/compose/send", { method: "POST", json: payload });

/* ------------------ Bulk Import ------------------ */
export async function apiPreview(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return api("/contacts/import/preview", {
    method: "POST",
    body: fd,
  }) as Promise<{
    upload_id: string;
    columns: string[];
    sample: any[];
    target_fields: string[];
  }>;
}

export async function apiCommit(
  upload_id: string,
  mapping: Record<string, string>,
  validate: boolean
) {
  const fd = new FormData();
  fd.append("upload_id", upload_id);
  fd.append("mapping_json", JSON.stringify(mapping));
  fd.append("validate", String(validate));
  return api("/contacts/import/commit", {
    method: "POST",
    body: fd,
  }) as Promise<{
    created: number;
    updated: number;
    validated: number;
  }>;
}
