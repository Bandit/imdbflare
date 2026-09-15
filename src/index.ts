const RECORD_BYTES = 5;
const MISSING_RATING = 0;
const TITLE_PATH = /^\/title\/(tt(\d{7,10}))\/?$/;

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, { Allow: "GET, OPTIONS" });
    }

    const match = new URL(request.url).pathname.match(TITLE_PATH);
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