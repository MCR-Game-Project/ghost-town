import { isAuthorized, unauthorized } from "../../lib/auth.js";

const OPEN = new Set(["/api/admin/login"]);

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (OPEN.has(path) || OPEN.has(url.pathname)) {
    return context.next();
  }
  if (!(await isAuthorized(context))) {
    return unauthorized();
  }
  return context.next();
}
