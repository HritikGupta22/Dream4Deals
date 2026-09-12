const BASE = typeof window === "undefined"
  ? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
  : "";

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  return res.json();
}

export function apiPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string, token?: string): Promise<T> {
  return apiFetch<T>(path, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export function apiPatch<T>(path: string, body: unknown, token?: string): Promise<T> {
  return apiFetch<T>(path, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

export const money = (v: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
