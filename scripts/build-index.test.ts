import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildIndex } from "./build-index";

describe("buildIndex", () => {
  it("writes fixed-offset records and leaves missing IDs empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "imdbflare-"));
    const inputPath = join(directory, "ratings.tsv.gz");
    const outputPath = join(directory, "ratings.bin");
    const tsv = [
      "tconst\taverageRating\tnumVotes",
      "tt0000001\t5.7\t2232",
      "tt0000003\t8.2\t123456",
      "",
    ].join("\n");
    await writeFile(inputPath, gzipSync(tsv));

    const metadata = await buildIndex(inputPath, outputPath);
    const index = await readFile(outputPath);
    const view = new DataView(index.buffer, index.byteOffset, index.byteLength);

    expect(metadata).toMatchObject({ records: 2, maxId: 3, byteLength: 20 });
    expect([...index.subarray(10, 15)]).toEqual([0, 0, 0, 0, 0]);
    expect(view.getUint8(15)).toBe(82);
    expect(view.getUint32(16, true)).toBe(123456);
  });
});