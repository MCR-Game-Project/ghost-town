import { isAuthorized, loginCookie, logoutCookie, unauthorized } from "../../lib/auth.js";

export async function onRequestGet(context) {
  const ok = await isAuthorized(context);
  if (!ok) return unauthorized();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPost(context) {
  let password = "";
  const type = context.request.headers.get("content-type") || "";
  try {
    if (type.includes("application/json")) {
      const body = await context.request.json();
      password = String(body.password ?? "");
    } else {
      const form = await context.request.formData();
      password = String(form.get("password") ?? "");
    }
  } catch {
    return unauthorized();
  }

  const cookie = await loginCookie(context, password);
  if (!cookie) return unauthorized();
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } },
  );
}

export async function onRequestDelete(context) {
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": logoutCookie(context),
        "Cache-Control": "no-store",
      },
    },
  );
}
