export const MAX_BYTES = 15 * 1024 * 1024;
export const MIN_YEAR = 1850;
export const MAX_YEAR = 2026;
export const MAX_ADDRESS = 200;
export const MAX_NOTES = 2000;

const KINDS = {
  "image/jpeg": { ext: "jpg", test: isJpeg },
  "image/png": { ext: "png", test: isPng },
  "image/webp": { ext: "webp", test: isWebp },
};

function isJpeg(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes) {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function isWebp(bytes) {
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return riff === "RIFF" && webp === "WEBP";
}

export function detectImage(bytes, declaredType, fileName) {
  if (!bytes || bytes.length < 12) return { error: "That file does not look like a photo." };
  if (bytes.length > MAX_BYTES) {
    return { error: "Please choose a photo smaller than 15 MB." };
  }

  let type = (declaredType || "").toLowerCase();
  if (type === "image/jpg") type = "image/jpeg";

  const name = (fileName || "").toLowerCase();
  if (!type) {
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) type = "image/jpeg";
    else if (name.endsWith(".png")) type = "image/png";
    else if (name.endsWith(".webp")) type = "image/webp";
  }

  const kind = KINDS[type];
  if (!kind) {
    return { error: "Please use a JPG, PNG, or WebP photo." };
  }
  if (!kind.test(bytes)) {
    return { error: "That file does not look like a photo." };
  }
  return { contentType: type, ext: kind.ext };
}

export function parseYear(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}$/.test(text)) return null;
  const year = Number(text);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  return year;
}

export function cleanText(value, max) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length > max) return null;
  return text;
}

export function isId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

export function recordKey(id) {
  return `submissions/${id}.json`;
}

export function bucket(env) {
  const photos = env.PHOTOS;
  if (!photos) {
    throw new Error("The photo storage binding is not set up.");
  }
  return photos;
}

export async function putSubmission(env, record, imageBytes) {
  const r2 = bucket(env);
  await r2.put(record.imageKey, imageBytes, {
    httpMetadata: { contentType: record.contentType },
    customMetadata: { submissionId: record.id },
  });
  await r2.put(recordKey(record.id), JSON.stringify(record, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function getSubmission(env, id) {
  if (!isId(id)) return null;
  const obj = await bucket(env).get(recordKey(id));
  if (!obj) return null;
  try {
    return await obj.json();
  } catch {
    return null;
  }
}

export async function saveSubmission(env, record) {
  await bucket(env).put(recordKey(record.id), JSON.stringify(record, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function listSubmissions(env) {
  const r2 = bucket(env);
  const records = [];
  let cursor;
  do {
    const page = await r2.list({ prefix: "submissions/", cursor, limit: 1000 });
    for (const obj of page.objects) {
      if (!obj.key.endsWith(".json")) continue;
      const body = await r2.get(obj.key);
      if (!body) continue;
      try {
        records.push(await body.json());
      } catch {
        // skip a damaged record rather than failing the whole list
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  records.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  return records;
}

export async function getPhoto(env, record) {
  if (!record?.imageKey) return null;
  return bucket(env).get(record.imageKey);
}

export function publicRecord(record) {
  return {
    id: record.id,
    year: record.year,
    address: record.address,
    notes: record.notes || "",
    submittedAt: record.submittedAt,
    status: record.status,
    reviewedAt: record.reviewedAt || null,
  };
}
