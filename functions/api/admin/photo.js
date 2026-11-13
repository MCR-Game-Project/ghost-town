import { getPhoto, getSubmission, isId } from "../../lib/store.js";

export async function onRequestGet(context) {
  const id = new URL(context.request.url).searchParams.get("id");
  if (!isId(id)) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const record = await getSubmission(context.env, id);
  if (!record) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const obj = await getPhoto(context.env, record);
  if (!obj) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const type = record.contentType || obj.httpMetadata?.contentType || "application/octet-stream";
  return new Response(obj.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, no-store",
    },
  });
}
