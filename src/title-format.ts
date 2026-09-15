export const TITLE_HEADER_BYTES = 32;
export const TITLE_SLOT_BYTES = 12;
export const TITLE_SLOT_COUNT = 1 << 22;
export const TITLE_DATA_OFFSET = TITLE_HEADER_BYTES + TITLE_SLOT_BYTES * TITLE_SLOT_COUNT;
export const TITLE_PROBE_SLOTS = 16;

const TITLE_RECORD_HEADER_BYTES = 23;
const ADULT_FLAG = 1;

export const TITLE_TYPES = [
  "movie",
  "short",
  "tvMiniSeries",
  "tvMovie",
  "tvPilot",
  "tvSeries",
  "tvShort",
  "tvSpecial",
  "video",
  "videoGame",
] as const;

export const GENRES = [
  "Action",
  "Adult",
  "Adventure",
  "Animation",
  "Biography",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Fantasy",
  "Film-Noir",
  "Game-Show",
  "History",
  "Horror",
  "Music",
  "Musical",
  "Mystery",
  "News",
  "Reality-TV",
  "Romance",
  "Sci-Fi",
  "Short",
  "Sport",
  "Talk-Show",
  "Thriller",
  "War",
  "Western",
] as const;

export interface TitleRecord {
  title: string;
  originalTitle: string;
  type: (typeof TITLE_TYPES)[number];
  genres: string[];
  startYear: number | null;
  endYear: number | null;
  runtimeMinutes: number | null;
  adult: boolean;
  rating: number | null;
  votes: number | null;
}

export function titleSlot(id: number, slotCount = TITLE_SLOT_COUNT): number {
  return (Math.imul(id, 0x9e3779b1) >>> 0) & (slotCount - 1);
}

export function encodeTitleRecord(record: TitleRecord): Uint8Array {
  const encoder = new TextEncoder();
  const title = encoder.encode(record.title);
  const originalTitle = record.originalTitle === record.title
    ? new Uint8Array()
    : encoder.encode(record.originalTitle);
  const type = TITLE_TYPES.indexOf(record.type);
  if (type === -1) throw new Error(`Unsupported title type: ${record.type}`);
  if (title.byteLength > 0xffff || originalTitle.byteLength > 0xffff) {
    throw new Error("Title exceeds binary format limit");
  }

  let genreMask = 0;
  for (const genre of record.genres) {
    const genreIndex = GENRES.indexOf(genre as (typeof GENRES)[number]);
    if (genreIndex === -1) throw new Error(`Unsupported genre: ${genre}`);
    genreMask |= 1 << genreIndex;
  }

  const bytes = new Uint8Array(
    TITLE_RECORD_HEADER_BYTES + title.byteLength + originalTitle.byteLength,
  );
  const view = new DataView(bytes.buffer);
  view.setUint8(0, record.rating === null ? 0 : Math.round(record.rating * 10));
  view.setUint32(1, record.votes ?? 0, true);
  view.setUint8(5, type);
  view.setUint8(6, record.adult ? ADULT_FLAG : 0);
  view.setUint16(7, record.startYear ?? 0, true);
  view.setUint16(9, record.endYear ?? 0, true);
  view.setUint32(11, record.runtimeMinutes ?? 0, true);
  view.setUint32(15, genreMask, true);
  view.setUint16(19, title.byteLength, true);
  view.setUint16(21, originalTitle.byteLength, true);
  bytes.set(title, TITLE_RECORD_HEADER_BYTES);
  bytes.set(originalTitle, TITLE_RECORD_HEADER_BYTES + title.byteLength);
  return bytes;
}

export function decodeTitleRecord(bytes: ArrayBufferLike): TitleRecord {
  if (bytes.byteLength < TITLE_RECORD_HEADER_BYTES) {
    throw new Error("Invalid title record");
  }

  const view = new DataView(bytes);
  const titleLength = view.getUint16(19, true);
  const originalTitleLength = view.getUint16(21, true);
  if (TITLE_RECORD_HEADER_BYTES + titleLength + originalTitleLength !== bytes.byteLength) {
    throw new Error("Invalid title record length");
  }

  const decoder = new TextDecoder();
  const title = decoder.decode(
    new Uint8Array(bytes, TITLE_RECORD_HEADER_BYTES, titleLength),
  );
  const originalTitle = originalTitleLength === 0
    ? title
    : decoder.decode(new Uint8Array(
        bytes,
        TITLE_RECORD_HEADER_BYTES + titleLength,
        originalTitleLength,
      ));
  const type = TITLE_TYPES[view.getUint8(5)];
  if (!type) throw new Error("Invalid title type");
  const genreMask = view.getUint32(15, true);
  const rating = view.getUint8(0);

  return {
    title,
    originalTitle,
    type,
    genres: GENRES.filter((_, index) => (genreMask & (1 << index)) !== 0),
    startYear: view.getUint16(7, true) || null,
    endYear: view.getUint16(9, true) || null,
    runtimeMinutes: view.getUint32(11, true) || null,
    adult: (view.getUint8(6) & ADULT_FLAG) !== 0,
    rating: rating === 0 ? null : rating / 10,
    votes: rating === 0 ? null : view.getUint32(1, true),
  };
}