import { listSubmissions, publicRecord } from "../../lib/store.js";

export async function onRequestGet(context) {
  try {
    const submissions = (await listSubmissions(context.env)).map(publicRecord);
    return Response.json(
      { ok: true, submissions },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("list failed", err);
    return Response.json(
      { ok: false, error: "The photo list could not be loaded just now." },
      { status: 500 },
    );
  }
}
