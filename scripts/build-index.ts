import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

const RECORD_BYTES = 5;
const EXPECTED_HEADER = "tconst\taverageRating\tnumVotes";

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
      if (line !== EXPECTED_HEADER) {
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

export async function buildIndex(inputPath: string, outputPath: string) {
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

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, index);

  const metadataPath = outputPath.endsWith(".bin")
    ? `${outputPath.slice(0, -4)}.meta.json`
    : `${outputPath}.meta.json`;
  const metadata = {
    generatedAt: new Date().toISOString(),
    source: "https://datasets.imdbws.com/title.ratings.tsv.gz",
    records,
    maxId,
    recordBytes: RECORD_BYTES,
    byteLength: index.byteLength,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const inputPath = resolve(process.argv[2] ?? "data/title.ratings.tsv.gz");
  const outputPath = resolve(process.argv[3] ?? "dist/ratings.bin");
  const metadata = await buildIndex(inputPath, outputPath);
  console.log(JSON.stringify(metadata));
}