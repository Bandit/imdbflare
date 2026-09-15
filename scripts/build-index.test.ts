import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildIndex, buildIndexes } from "./build-index";
import {
  decodeTitleRecord,
  TITLE_HEADER_BYTES,
  TITLE_SLOT_BYTES,
  titleSlot,
} from "../src/title-format";

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

describe("buildIndexes", () => {
  it("includes rated, recent unrated, and unknown-year top-level titles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "imdbflare-"));
    const ratingsPath = join(directory, "ratings.tsv.gz");
    const basicsPath = join(directory, "basics.tsv.gz");
    const outputDirectory = join(directory, "dist");
    await writeFile(ratingsPath, gzipSync([
      "tconst\taverageRating\tnumVotes",
      "tt0000001\t5.7\t2232",
      "tt0000002\t8.1\t100",
      "",
    ].join("\n")));
    await writeFile(basicsPath, gzipSync([
      "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres",
      "tt0000001\tmovie\tOld Rated\tOld Rated\t0\t1990\t\\N\t90\tDrama",
      "tt0000002\ttvEpisode\tRated Episode\tRated Episode\t0\t2026\t\\N\t40\tDrama",
      "tt0000003\tmovie\tOld Unrated\tOld Unrated\t0\t2022\t\\N\t100\tComedy",
      "tt0000004\ttvSeries\tRecent Unrated\tOriginal Name\t0\t2023\t\\N\t\\N\tComedy,Drama",
      "tt0000005\tmovie\tUnknown Year\tUnknown Year\t0\t\\N\t\\N\t95\tMystery",
      "tt0000006\tmovie\tAdult Title\tAdult Title\t1\t2026\t\\N\t80\tAdult",
      "",
    ].join("\n")));

    const metadata = await buildIndexes(
      ratingsPath,
      basicsPath,
      outputDirectory,
      2026,
      16,
    );
    const titles = await readFile(join(outputDirectory, "titles.bin"));
    const view = new DataView(titles.buffer, titles.byteOffset, titles.byteLength);

    expect(metadata.titles).toMatchObject({
      records: 3,
      ratedRecords: 1,
      recentUnratedRecords: 1,
      unknownYearUnratedRecords: 1,
      excludedAdultRecords: 1,
      cutoffYear: 2023,
    });

    const slot = titleSlot(4, 16) * TITLE_SLOT_BYTES;
    expect(view.getUint32(TITLE_HEADER_BYTES + slot, true)).toBe(4);
    const relativeOffset = view.getUint32(TITLE_HEADER_BYTES + slot + 4, true);
    const length = view.getUint16(TITLE_HEADER_BYTES + slot + 8, true);
    const dataOffset = view.getUint32(24, true);
    const record = titles.subarray(
      dataOffset + relativeOffset,
      dataOffset + relativeOffset + length,
    );
    expect(decodeTitleRecord(record.buffer.slice(
      record.byteOffset,
      record.byteOffset + record.byteLength,
    ))).toMatchObject({
      title: "Recent Unrated",
      originalTitle: "Original Name",
      type: "tvSeries",
      genres: ["Comedy", "Drama"],
      rating: null,
      votes: null,
    });
  });
});