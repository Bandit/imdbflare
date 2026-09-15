import { describe, expect, it } from "vitest";

import { decodeTitleRecord, encodeTitleRecord, titleSlot } from "./title-format";

describe("title binary format", () => {
  it("round-trips compact title details", () => {
    const encoded = encodeTitleRecord({
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

    expect(decodeTitleRecord(encoded.buffer)).toEqual({
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
  });

  it("preserves unrated and translated titles", () => {
    const encoded = encodeTitleRecord({
      title: "Poor Pierrot",
      originalTitle: "Pauvre Pierrot",
      type: "short",
      genres: ["Animation", "Comedy", "Romance"],
      startYear: 2027,
      endYear: null,
      runtimeMinutes: null,
      rating: null,
      votes: null,
    });

    expect(decodeTitleRecord(encoded.buffer)).toMatchObject({
      originalTitle: "Pauvre Pierrot",
      rating: null,
      votes: null,
    });
  });

  it("maps the same numeric ID to a stable hash slot", () => {
    expect(titleSlot(33332385)).toBe(titleSlot(33332385));
    expect(titleSlot(33332385)).toBeGreaterThanOrEqual(0);
  });
});