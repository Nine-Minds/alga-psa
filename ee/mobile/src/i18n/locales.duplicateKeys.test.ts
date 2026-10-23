import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES_DIR = join(__dirname, "locales");

/**
 * Collect every duplicated key path in a JSON document.
 *
 * `JSON.parse` keeps only the last of a set of duplicate keys and reports no
 * error, so a namespace can lose a whole block of strings without any parser,
 * linter or typechecker noticing — the affected screens then render raw key
 * paths. The parsed result cannot show this, and neither can a reviver (the
 * object is built, last-wins, before any property is revived), so duplicates
 * are only visible by scanning the source text.
 *
 * Throws on malformed JSON, so a mis-scan cannot pass as "no duplicates".
 */
export function findDuplicateKeyPaths(source: string): string[] {
  JSON.parse(source); // reject anything this hand-rolled scanner should not see

  const duplicates: string[] = [];
  let i = 0;

  const skipWhitespace = () => {
    while (i < source.length && /\s/.test(source[i])) i += 1;
  };

  const readStringToken = (): string => {
    const start = i;
    i += 1; // opening quote
    while (source[i] !== '"') {
      i += source[i] === "\\" ? 2 : 1;
    }
    i += 1; // closing quote
    return JSON.parse(source.slice(start, i)) as string;
  };

  const readValue = (path: string) => {
    skipWhitespace();
    const char = source[i];

    if (char === "{") {
      i += 1;
      const keys = new Set<string>();
      skipWhitespace();
      if (source[i] === "}") {
        i += 1;
        return;
      }
      for (;;) {
        skipWhitespace();
        const key = readStringToken();
        const keyPath = path ? `${path}.${key}` : key;
        if (keys.has(key)) duplicates.push(keyPath);
        else keys.add(key);
        skipWhitespace();
        i += 1; // ':'
        readValue(keyPath);
        skipWhitespace();
        i += 1; // ',' or '}'
        if (source[i - 1] === "}") return;
      }
    }

    if (char === "[") {
      i += 1;
      skipWhitespace();
      if (source[i] === "]") {
        i += 1;
        return;
      }
      let index = 0;
      for (;;) {
        readValue(`${path}[${index}]`);
        index += 1;
        skipWhitespace();
        i += 1; // ',' or ']'
        if (source[i - 1] === "]") return;
      }
    }

    if (char === '"') {
      readStringToken();
      return;
    }

    while (i < source.length && !/[\s,}\]]/.test(source[i])) i += 1; // number, bool, null
  };

  readValue("");
  skipWhitespace();
  if (i !== source.length) {
    throw new Error(`scanner stopped at offset ${i} of ${source.length}`);
  }

  return duplicates;
}

describe("locale namespaces", () => {
  const files = readdirSync(LOCALES_DIR, { recursive: true, encoding: "utf8" }).filter((entry) =>
    entry.endsWith(".json"),
  );

  it("finds locale files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s declares each key exactly once", (file) => {
    const source = readFileSync(join(LOCALES_DIR, file), "utf8");
    expect(findDuplicateKeyPaths(source)).toEqual([]);
  });
});

describe("findDuplicateKeyPaths", () => {
  it("detects a duplicate key that JSON.parse would silently drop", () => {
    const withDuplicate = '{"detail":{"bundle":{"a":1},"other":2,"bundle":{"b":3}}}';
    expect(JSON.parse(withDuplicate).detail.bundle).toEqual({ b: 3 });
    expect(findDuplicateKeyPaths(withDuplicate)).toEqual(["detail.bundle"]);
  });

  it("does not flag the same key name used under different parents", () => {
    expect(findDuplicateKeyPaths('{"a":{"title":1},"b":{"title":2}}')).toEqual([]);
  });

  it("scans past every value type without losing its place", () => {
    const source = JSON.stringify({
      s: 'quoted " and \\ and {braces}',
      n: -1.5e10,
      bools: [true, false, null],
      nested: [{ a: [[{ b: 1 }]] }],
      empty: [{}, []],
    });
    expect(findDuplicateKeyPaths(source)).toEqual([]);
  });

  it("reports duplicates nested inside arrays", () => {
    expect(findDuplicateKeyPaths('{"xs":[{"a":1,"a":2}]}')).toEqual(["xs[0].a"]);
  });

  it("rejects malformed JSON rather than reporting no duplicates", () => {
    expect(() => findDuplicateKeyPaths('{"a":')).toThrow();
  });
});
