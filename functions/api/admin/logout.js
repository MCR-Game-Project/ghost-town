import { logoutCookie } from "../../lib/auth.js";

export async function onRequestPost(context) {
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
