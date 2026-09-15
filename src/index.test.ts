import { describe, expect, it, vi } from "vitest";

import worker, { type Env } from "./index";
import {
  encodeTitleRecord,
  TITLE_DATA_OFFSET,
  TITLE_HEADER_BYTES,
  TITLE_PROBE_SLOTS,
  TITLE_SLOT_BYTES,
  titleSlot,
} from "./title-format";

function envWithRecord(record: Uint8Array | null): Env {
  return {
    RATINGS: {
      get: vi.fn(async () =>
        record
          ? { arrayBuffer: async () => record.buffer } as R2ObjectBody
          : null,
      ),
    } as unknown as R2Bucket,
  };
}

describe("rating API", () => {
  it("returns a rating and vote count from the indexed record", async () => {
    const record = new Uint8Array(5);
    const view = new DataView(record.buffer);
    view.setUint8(0, 57);
    view.setUint32(1, 2232, true);
    const env = envWithRecord(record);

    const response = await worker.fetch(
      new Request("https://example.com/title/tt0000001"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "tt0000001",
      rating: 5.7,
      votes: 2232,
    });
    expect(env.RATINGS.get).toHaveBeenCalledWith("ratings.bin", {
      range: { offset: 5, length: 5 },
    });
  });

  it("returns packed top-level title details", async () => {
    const numericId = 33332385;
    const record = encodeTitleRecord({
      title: "Widow's Bay",
      originalTitle: "Widow's Bay",
      type: "tvSeries",
      genres: ["Comedy", "Drama", "Horror"],
      startYear: 2026,
      endYear: null,
      runtimeMinutes: 40,
      rating: 8.1,
      votes: 76498,
    });
    const probe = new Uint8Array(TITLE_PROBE_SLOTS * TITLE_SLOT_BYTES);
    const probeView = new DataView(probe.buffer);
    probeView.setUint32(0, numericId, true);
    probeView.setUint32(4, 0, true);
    probeView.setUint16(8, record.byteLength, true);
    const get = vi.fn(async (_key: string, options: R2GetOptions) => {
      const range = options.range as { offset: number; length: number };
      const bytes = range.offset === TITLE_DATA_OFFSET ? record : probe;
      return { arrayBuffer: async () => bytes.buffer } as R2ObjectBody;
    });
    const env = { RATINGS: { get } as unknown as R2Bucket };

    const response = await worker.fetch(
      new Request("https://example.com/title/tt33332385/details"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "tt33332385",
      title: "Widow's Bay",
      originalTitle: "Widow's Bay",
      type: "tvSeries",
      genres: ["Comedy", "Drama", "Horror"],
      startYear: 2026,
      endYear: null,
      runtimeMinutes: 40,
      rating: 8.1,
      votes: 76498,
    });
    expect(get).toHaveBeenNthCalledWith(1, "titles.bin", {
      range: {
        offset: TITLE_HEADER_BYTES + titleSlot(numericId) * TITLE_SLOT_BYTES,
        length: TITLE_PROBE_SLOTS * TITLE_SLOT_BYTES,
      },
    });
    expect(get).toHaveBeenNthCalledWith(2, "titles.bin", {
      range: { offset: TITLE_DATA_OFFSET, length: record.byteLength },
    });
  });

  it("returns 404 for a missing rating record", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/title/tt0000001"),
      envWithRecord(new Uint8Array(5)),
    );

    expect(response.status).toBe(404);
  });

  it("rejects malformed IMDb IDs without reading R2", async () => {
    const env = envWithRecord(null);
    const response = await worker.fetch(
      new Request("https://example.com/title/123"),
      env,
    );

    expect(response.status).toBe(404);
    expect(env.RATINGS.get).not.toHaveBeenCalled();
  });
});