import { getSubmission, isId, saveSubmission, publicRecord } from "../../lib/store.js";

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: "Please send a review decision." }, { status: 400 });
  }

  const id = body?.id;
  const status = body?.status;
  if (!isId(id)) {
    return Response.json({ ok: false, error: "That submission was not found." }, { status: 404 });
  }
  if (status !== "approved" && status !== "rejected") {
    return Response.json({ ok: false, error: "Please choose Approve or Reject." }, { status: 400 });
  }

  const record = await getSubmission(context.env, id);
  if (!record) {
    return Response.json({ ok: false, error: "That submission was not found." }, { status: 404 });
  }

  record.status = status;
  record.reviewedAt = new Date().toISOString();
  await saveSubmission(context.env, record);
  return Response.json({ ok: true, submission: publicRecord(record) });
}
