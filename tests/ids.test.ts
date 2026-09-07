import { describe, expect, test } from "bun:test";
import { chunkIdFor, sourceIdFor, uuidFromHex } from "../src/ingest/ids.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("ids", () => {
  test("sourceIdFor is stable and path-separator agnostic", () => {
    expect(sourceIdFor("docs/a.md")).toBe(sourceIdFor("docs\\a.md"));
    expect(sourceIdFor("docs/a.md")).not.toBe(sourceIdFor("docs/b.md"));
  });

  test("chunkIdFor is a valid UUID and deterministic", () => {
    const id = chunkIdFor("abc", 0);
    expect(id).toMatch(UUID_RE);
    expect(chunkIdFor("abc", 0)).toBe(id);
    expect(chunkIdFor("abc", 1)).not.toBe(id);
    expect(chunkIdFor("abd", 0)).not.toBe(id);
  });

  test("uuidFromHex sets version and variant nibbles", () => {
    expect(uuidFromHex("0".repeat(64))).toMatch(UUID_RE);
    expect(uuidFromHex("f".repeat(64))).toMatch(UUID_RE);
  });
});
