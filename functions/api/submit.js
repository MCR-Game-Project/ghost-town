import {
  cleanText,
  detectImage,
  MAX_ADDRESS,
  MAX_BYTES,
  MAX_NOTES,
  parseYear,
  putSubmission,
} from "../lib/store.js";

const THANKS = "Thanks! Your photo will be reviewed before it's added.";

function bad(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function thanks() {
  return Response.json({ ok: true, message: THANKS });
}

export async function onRequestPost(context) {
  const length = Number(context.request.headers.get("content-length") || "0");
  if (length > MAX_BYTES + 64 * 1024) {
    return bad("Please choose a photo smaller than 15 MB.", 413);
  }

  let form;
  try {
    form = await context.request.formData();
  } catch {
    return bad("Please send the form as a photo upload.");
  }

  // Honeypot: pretend success so a bot does not learn that the field is watched.
  const trap = String(form.get("company") || "").trim();
  if (trap) return thanks();

  const year = parseYear(form.get("year"));
  if (year === null) {
    return bad("Please enter a 4-digit year between 1850 and 2026.");
  }

  const address = cleanText(form.get("address"), MAX_ADDRESS);
  if (!address) {
    return bad("Please enter the address or the place shown in the photo.");
  }

  const notesRaw = form.get("notes");
  const notes = cleanText(notesRaw ?? "", MAX_NOTES);
  if (notes === null) {
    return bad("Please keep the notes under 2,000 characters.");
  }

  const file = form.get("photo");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return bad("Please choose a photo to upload.");
  }
  if (file.size > MAX_BYTES) {
    return bad("Please choose a photo smaller than 15 MB.", 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectImage(bytes, file.type, file.name);
  if (detected.error) return bad(detected.error);

  const id = crypto.randomUUID();
  const record = {
    id,
    year,
    address,
    notes: notes || "",
    imageKey: `images/${id}.${detected.ext}`,
    contentType: detected.contentType,
    submittedAt: new Date().toISOString(),
    status: "pending",
    reviewedAt: null,
  };

  try {
    await putSubmission(context.env, record, bytes);
  } catch (err) {
    console.error("submit failed", err);
    return bad("The photo could not be saved just now. Please try again in a little while.", 500);
  }

  return thanks();
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { Allow: "POST, OPTIONS" },
    });
  }
  return new Response("Use the photo form to send a picture.", {
    status: 405,
    headers: { Allow: "POST, OPTIONS" },
  });
}
