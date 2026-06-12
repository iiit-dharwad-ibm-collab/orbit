const API_BASE = "";

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("dg_token");
}

function getHeaders() {
  const h = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: getHeaders(),
    ...options,
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("dg_token");
      localStorage.removeItem("dg_user");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  return res;
}

export async function apiJson(path, options = {}) {
  const res = await api(path, options);
  return res.json();
}

export async function login(username, password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed");
  localStorage.setItem("dg_token", data.token);
  localStorage.setItem("dg_user", data.username);
  return data;
}

export async function register(username, password) {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Registration failed");
  localStorage.setItem("dg_token", data.token);
  localStorage.setItem("dg_user", data.username);
  return data;
}

export function logout() {
  localStorage.removeItem("dg_token");
  localStorage.removeItem("dg_user");
  window.location.href = "/login";
}

export function isLoggedIn() {
  return !!getToken();
}

export function getUsername() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("dg_user") || "";
}
