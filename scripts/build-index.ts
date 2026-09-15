import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

import {
  encodeTitleRecord,
  TITLE_DATA_OFFSET,
  TITLE_HEADER_BYTES,
  TITLE_SLOT_BYTES,
  TITLE_SLOT_COUNT,
  titleSlot,
  type TitleRecord,
} from "../src/title-format";

const RECORD_BYTES = 5;
const EXPECTED_RATINGS_HEADER = "tconst\taverageRating\tnumVotes";
const EXPECTED_BASICS_HEADER = [
  "tconst",
  "titleType",
  "primaryTitle",
  "originalTitle",
  "isAdult",
  "startYear",
  "endYear",
  "runtimeMinutes",
  "genres",
].join("\t");

interface ScanResult {
  maxId: number;
  records: number;
}

async function lines(inputPath: string) {
  return createInterface({
    input: createReadStream(inputPath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
}

function parseId(value: string, lineNumber: number): number {
  const match = /^tt(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid tconst on line ${lineNumber}: ${value}`);
  }

  return Number(match[1]);
}

async function scanDump(inputPath: string): Promise<ScanResult> {
  let maxId = 0;
  let records = 0;
  let lineNumber = 0;

  for await (const line of await lines(inputPath)) {
    lineNumber += 1;
    if (lineNumber === 1) {
      if (line !== EXPECTED_RATINGS_HEADER) {
        throw new Error(`Unexpected ratings header: ${line}`);
      }
      continue;
    }

    const tab = line.indexOf("\t");
    const id = parseId(tab === -1 ? line : line.slice(0, tab), lineNumber);
    maxId = Math.max(maxId, id);
    records += 1;
  }

  return { maxId, records };
}

async function createRatingsIndex(inputPath: string) {
  const { maxId, records } = await scanDump(inputPath);
  const index = new Uint8Array((maxId + 1) * RECORD_BYTES);
  const view = new DataView(index.buffer);
  let lineNumber = 0;
  let written = 0;

  for await (const line of await lines(inputPath)) {
    lineNumber += 1;
    if (lineNumber === 1) continue;

    const [tconst, averageRating, numVotes] = line.split("\t");
    const id = parseId(tconst, lineNumber);
    const rating = Math.round(Number(averageRating) * 10);
    const votes = Number(numVotes);
    if (!Number.isInteger(rating) || rating < 1 || rating > 100) {
      throw new Error(`Invalid rating on line ${lineNumber}: ${averageRating}`);
    }
    if (!Number.isSafeInteger(votes) || votes < 0 || votes > 0xffffffff) {
      throw new Error(`Invalid vote count on line ${lineNumber}: ${numVotes}`);
    }

    const offset = id * RECORD_BYTES;
    view.setUint8(offset, rating);
    view.setUint32(offset + 1, votes, true);
    written += 1;
  }

  if (written !== records) {
    throw new Error(`Expected ${records} records, wrote ${written}`);
  }

  const metadata = {
    generatedAt: new Date().toISOString(),
    source: "https://datasets.imdbws.com/title.ratings.tsv.gz",
    records,
    maxId,
    recordBytes: RECORD_BYTES,
    byteLength: index.byteLength,
  };

  return { index, metadata };
}

async function writeMetadata(outputPath: string, metadata: object) {
  const metadataPath = outputPath.endsWith(".bin")
    ? `${outputPath.slice(0, -4)}.meta.json`
    : `${outputPath}.meta.json`;
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

export async function buildIndex(inputPath: string, outputPath: string) {
  const { index, metadata } = await createRatingsIndex(inputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, index);
  await writeMetadata(outputPath, metadata);

  return metadata;
}

function nullableNumber(value: string): number | null {
  return value === "\\N" ? null : Number(value);
}

function ratingFor(index: Uint8Array, id: number) {
  const offset = id * RECORD_BYTES;
  if (offset + RECORD_BYTES > index.byteLength || index[offset] === 0) {
    return { rating: null, votes: null };
  }

  return {
    rating: index[offset] / 10,
    votes: new DataView(index.buffer).getUint32(offset + 1, true),
  };
}

export async function buildTitleIndex(
  basicsPath: string,
  outputPath: string,
  ratingsIndex: Uint8Array,
  currentYear = new Date().getUTCFullYear(),
  slotCount = TITLE_SLOT_COUNT,
) {
  if (slotCount < 2 || (slotCount & (slotCount - 1)) !== 0) {
    throw new Error("Title slot count must be a power of two");
  }

  const cutoffYear = currentYear - 3;
  const dataOffset = TITLE_HEADER_BYTES + slotCount * TITLE_SLOT_BYTES;
  const table = new Uint8Array(slotCount * TITLE_SLOT_BYTES);
  const tableView = new DataView(table.buffer);
  const temporaryPath = `${outputPath}.records.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  const recordsFile = await open(temporaryPath, "w");
  let pendingRecords: Uint8Array[] = [];
  let pendingBytes = 0;
  let recordsByteLength = 0;
  let records = 0;
  let ratedRecords = 0;
  let recentUnratedRecords = 0;
  let unknownYearUnratedRecords = 0;
  let excludedAdultRecords = 0;
  let lineNumber = 0;

  const flushRecords = async () => {
    if (pendingBytes === 0) return;
    await recordsFile.write(Buffer.concat(pendingRecords, pendingBytes));
    pendingRecords = [];
    pendingBytes = 0;
  };

  try {
    for await (const line of await lines(basicsPath)) {
      lineNumber += 1;
      if (lineNumber === 1) {
        if (line !== EXPECTED_BASICS_HEADER) {
          throw new Error(`Unexpected basics header: ${line}`);
        }
        continue;
      }

      const [
        tconst,
        titleType,
        primaryTitle,
        originalTitle,
        isAdult,
        startYearValue,
        endYearValue,
        runtimeValue,
        genresValue,
      ] = line.split("\t");
      if (titleType === "tvEpisode") continue;
      if (isAdult === "1") {
        excludedAdultRecords += 1;
        continue;
      }

      const id = parseId(tconst, lineNumber);
      const rating = ratingFor(ratingsIndex, id);
      const startYear = nullableNumber(startYearValue);
      if (rating.rating === null && startYear !== null && startYear < cutoffYear) {
        continue;
      }

      if (records + 1 > slotCount * 0.7) {
        throw new Error(`Title hash table is over 70% full at ${records + 1} records`);
      }

      const record = encodeTitleRecord({
        title: primaryTitle,
        originalTitle,
        type: titleType as TitleRecord["type"],
        genres: genresValue === "\\N" ? [] : genresValue.split(","),
        startYear,
        endYear: nullableNumber(endYearValue),
        runtimeMinutes: nullableNumber(runtimeValue),
        ...rating,
      });
      if (record.byteLength > 0xffff) {
        throw new Error(`Title record is too large on line ${lineNumber}`);
      }

      let slot = titleSlot(id, slotCount);
      while (tableView.getUint32(slot * TITLE_SLOT_BYTES, true) !== 0) {
        slot = (slot + 1) & (slotCount - 1);
      }
      const slotOffset = slot * TITLE_SLOT_BYTES;
      tableView.setUint32(slotOffset, id, true);
      tableView.setUint32(slotOffset + 4, recordsByteLength, true);
      tableView.setUint16(slotOffset + 8, record.byteLength, true);

      pendingRecords.push(record);
      pendingBytes += record.byteLength;
      recordsByteLength += record.byteLength;
      records += 1;
      if (rating.rating !== null) ratedRecords += 1;
      else if (startYear === null) unknownYearUnratedRecords += 1;
      else recentUnratedRecords += 1;
      if (pendingBytes >= 1024 * 1024) await flushRecords();
    }

    await flushRecords();
  } finally {
    await recordsFile.close();
  }

  const header = new Uint8Array(TITLE_HEADER_BYTES);
  header.set(new TextEncoder().encode("IMDBTL01"));
  const headerView = new DataView(header.buffer);
  headerView.setUint16(8, 1, true);
  headerView.setUint16(10, TITLE_SLOT_BYTES, true);
  headerView.setUint32(12, slotCount, true);
  headerView.setUint32(16, records, true);
  headerView.setUint16(20, cutoffYear, true);
  headerView.setUint32(24, dataOffset, true);

  const outputFile = await open(outputPath, "w");
  await outputFile.write(header);
  await outputFile.write(table);
  await outputFile.close();
  await pipeline(
    createReadStream(temporaryPath),
    createWriteStream(outputPath, { flags: "a" }),
  );
  await rm(temporaryPath);

  const metadata = {
    generatedAt: new Date().toISOString(),
    source: "https://datasets.imdbws.com/title.basics.tsv.gz",
    records,
    ratedRecords,
    recentUnratedRecords,
    unknownYearUnratedRecords,
    excludedAdultRecords,
    cutoffYear,
    excludesTitleType: "tvEpisode",
    slotCount,
    byteLength: dataOffset + recordsByteLength,
  };
  await writeMetadata(outputPath, metadata);
  return metadata;
}

export async function buildIndexes(
  ratingsPath: string,
  basicsPath: string,
  outputDirectory: string,
  currentYear = new Date().getUTCFullYear(),
  titleSlotCount = TITLE_SLOT_COUNT,
) {
  await mkdir(outputDirectory, { recursive: true });
  const { index, metadata: ratings } = await createRatingsIndex(ratingsPath);
  const ratingsOutput = join(outputDirectory, "ratings.bin");
  await writeFile(ratingsOutput, index);
  await writeMetadata(ratingsOutput, ratings);
  const titles = await buildTitleIndex(
    basicsPath,
    join(outputDirectory, "titles.bin"),
    index,
    currentYear,
    titleSlotCount,
  );
  return { ratings, titles };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const ratingsPath = resolve(process.argv[2] ?? "data/title.ratings.tsv.gz");
  const basicsPath = resolve(process.argv[3] ?? "data/title.basics.tsv.gz");
  const outputDirectory = resolve(process.argv[4] ?? "dist");
  const metadata = await buildIndexes(ratingsPath, basicsPath, outputDirectory);
  console.log(JSON.stringify(metadata));
}