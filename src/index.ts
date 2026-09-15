import {
  decodeTitleRecord,
  TITLE_DATA_OFFSET,
  TITLE_HEADER_BYTES,
  TITLE_PROBE_SLOTS,
  TITLE_SLOT_BYTES,
  TITLE_SLOT_COUNT,
  titleSlot,
} from "./title-format";

const RECORD_BYTES = 5;
const MISSING_RATING = 0;
const TITLE_PATH = /^\/title\/(tt(\d{7,10}))\/?$/;
const DETAILS_PATH = /^\/title\/(tt(\d{7,10}))\/details\/?$/;

export interface Env {
  RATINGS: R2Bucket;
}

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "public, max-age=3600",
      ...headers,
    },
  });
}

async function getTitleDetails(bucket: R2Bucket, id: number) {
  let slot = titleSlot(id);
  let probes = 0;

  while (probes < TITLE_SLOT_COUNT) {
    const slotsToRead = Math.min(TITLE_PROBE_SLOTS, TITLE_SLOT_COUNT - slot);
    const indexObject = await bucket.get("titles.bin", {
      range: {
        offset: TITLE_HEADER_BYTES + slot * TITLE_SLOT_BYTES,
        length: slotsToRead * TITLE_SLOT_BYTES,
      },
    });
    if (!indexObject) return null;

    const index = await indexObject.arrayBuffer();
    if (index.byteLength !== slotsToRead * TITLE_SLOT_BYTES) return null;
    const view = new DataView(index);
    for (let indexSlot = 0; indexSlot < slotsToRead; indexSlot += 1) {
      const offset = indexSlot * TITLE_SLOT_BYTES;
      const storedId = view.getUint32(offset, true);
      if (storedId === 0) return null;
      if (storedId !== id) continue;

      const recordOffset = view.getUint32(offset + 4, true);
      const recordLength = view.getUint16(offset + 8, true);
      const recordObject = await bucket.get("titles.bin", {
        range: {
          offset: TITLE_DATA_OFFSET + recordOffset,
          length: recordLength,
        },
      });
      if (!recordObject) return null;
      const record = await recordObject.arrayBuffer();
      if (record.byteLength !== recordLength) return null;
      return decodeTitleRecord(record);
    }

    probes += slotsToRead;
    slot = (slot + slotsToRead) & (TITLE_SLOT_COUNT - 1);
  }

  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, { Allow: "GET, OPTIONS" });
    }

    const pathname = new URL(request.url).pathname;
    const detailsMatch = pathname.match(DETAILS_PATH);
    if (detailsMatch) {
      const [, id, numericId] = detailsMatch;
      const details = await getTitleDetails(env.RATINGS, Number(numericId));
      return details
        ? json({ id, ...details })
        : json({ error: "Title details not found" }, 404);
    }

    const match = pathname.match(TITLE_PATH);
    if (!match) {
      return json({ error: "Not found" }, 404);
    }

    const [, id, numericId] = match;
    const offset = Number(numericId) * RECORD_BYTES;
    const object = await env.RATINGS.get("ratings.bin", {
      range: { offset, length: RECORD_BYTES },
    });

    if (!object) {
      return json({ error: "Title not found" }, 404);
    }

    const record = await object.arrayBuffer();
    if (record.byteLength !== RECORD_BYTES) {
      return json({ error: "Title not found" }, 404);
    }

    const view = new DataView(record);
    const rating = view.getUint8(0);
    if (rating === MISSING_RATING) {
      return json({ error: "Title not found" }, 404);
    }

    return json({
      id,
      rating: rating / 10,
      votes: view.getUint32(1, true),
    });
  },
} satisfies ExportedHandler<Env>;