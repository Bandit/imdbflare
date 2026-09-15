import { describe, expect, it, vi } from "vitest";

import worker, { type Env } from "./index";

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