const COOKIE = "gt_admin";
const TOKEN_PAYLOAD = "ghost-town-admin-v1";

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return "";
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) {
    let acc = 0;
    const dummy = encoder.encode("x".repeat(32));
    for (let i = 0; i < dummy.length; i++) acc |= dummy[i] ^ dummy[i];
    return acc === 1;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function tokenFor(password) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(TOKEN_PAYLOAD),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function cookieOptions(request) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  // 7 days
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`;
}

export function clearCookieOptions(request) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function isAuthorized(context) {
  const password = context.env.GT_ADMIN_PASSWORD;
  if (!password) return false;

  const header = context.request.headers.get("Authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const sep = decoded.indexOf(":");
      const given = sep === -1 ? decoded : decoded.slice(sep + 1);
      if (timingSafeEqual(given, password)) return true;
    } catch {
      return false;
    }
  }

  const token = getCookie(context.request, COOKIE);
  if (!token) return false;
  const expected = await tokenFor(password);
  return timingSafeEqual(token, expected);
}

export async function loginCookie(context, password) {
  const expected = context.env.GT_ADMIN_PASSWORD;
  if (!expected || !timingSafeEqual(password, expected)) return null;
  const token = await tokenFor(expected);
  return `${COOKIE}=${token}; ${cookieOptions(context.request)}`;
}

export function logoutCookie(context) {
  return `${COOKIE}=; ${clearCookieOptions(context.request)}`;
}

export function unauthorized(json = true) {
  if (json) {
    return Response.json(
      { ok: false, error: "Please sign in to review photos." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return new Response("Please sign in to review photos.", {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });
}
