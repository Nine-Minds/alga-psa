import { describe, expect, it } from "vitest";
import { appendNoteBlock, blockDataToText, paragraphBlock } from "./blockNote";

describe("blockDataToText", () => {
  it("returns empty string for absent or non-array notes", () => {
    expect(blockDataToText(null)).toBe("");
    expect(blockDataToText(undefined)).toBe("");
    expect(blockDataToText("just a string")).toBe("");
    expect(blockDataToText([])).toBe("");
  });

  it("flattens paragraph blocks to one line each", () => {
    const doc = [
      { type: "paragraph", content: [{ type: "text", text: "First line" }] },
      { type: "paragraph", content: [{ type: "text", text: "Second line" }] },
    ];
    expect(blockDataToText(doc)).toBe("First line\nSecond line");
  });

  it("joins multiple runs within a block and indents children", () => {
    const doc = [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
        children: [{ type: "paragraph", content: [{ type: "text", text: "nested" }] }],
      },
    ];
    expect(blockDataToText(doc)).toBe("Hello world\n  nested");
  });

  it("drops non-text blocks (images) instead of emitting blank lines", () => {
    const doc = [
      { type: "image", props: { url: "x" } },
      { type: "paragraph", content: [{ type: "text", text: "caption" }] },
    ];
    expect(blockDataToText(doc)).toBe("caption");
  });
});

describe("appendNoteBlock", () => {
  it("starts a fresh document when there is no existing content", () => {
    const result = appendNoteBlock(null, "On-site: replaced fan");
    expect(result).toEqual([paragraphBlock("On-site: replaced fan")]);
    expect(blockDataToText(result)).toBe("On-site: replaced fan");
  });

  it("preserves existing blocks and appends the new note last", () => {
    const existing = [{ type: "heading", content: [{ type: "text", text: "Runbook" }] }];
    const result = appendNoteBlock(existing, "Rebooted twice");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(existing[0]);
    expect(blockDataToText(result)).toBe("Runbook\nRebooted twice");
  });

  it("produces a paragraph matching the web editor's default shape", () => {
    const block = paragraphBlock("note");
    expect(block).toMatchObject({
      type: "paragraph",
      props: { textAlignment: "left", backgroundColor: "default", textColor: "default" },
      content: [{ type: "text", text: "note", styles: {} }],
    });
  });
});
