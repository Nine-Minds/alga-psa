import { describe, expect, it } from "vitest";
import {
  extractPlainTextFromRichEditorJson,
  extractPlainTextFromSerializedRichEditorContent,
} from "./helpers";

describe("mention text extraction", () => {
  describe("extractPlainTextFromRichEditorJson (BlockNote format)", () => {
    it("extracts @username from a mention inline content item", () => {
      const json = [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello ", styles: {} },
            { type: "mention", props: { userId: "u-1", username: "alice", displayName: "Alice Smith" } },
            { type: "text", text: " check this", styles: {} },
          ],
        },
      ];
      expect(extractPlainTextFromRichEditorJson(json)).toBe("Hello @alice check this");
    });

    it("falls back to @displayName when username is empty", () => {
      const json = [
        {
          type: "paragraph",
          content: [
            { type: "mention", props: { userId: "u-2", username: "", displayName: "Bob Jones" } },
          ],
        },
      ];
      expect(extractPlainTextFromRichEditorJson(json)).toBe("@Bob Jones");
    });

    it("extracts @everyone mention", () => {
      const json = [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "cc ", styles: {} },
            { type: "mention", props: { userId: "@everyone", username: "everyone", displayName: "Everyone" } },
          ],
        },
      ];
      expect(extractPlainTextFromRichEditorJson(json)).toBe("cc @everyone");
    });

    it("handles mention with missing props gracefully", () => {
      const json = [
        {
          type: "paragraph",
          content: [
            { type: "mention" },
          ],
        },
      ];
      expect(extractPlainTextFromRichEditorJson(json)).toBe("");
    });
  });

  describe("extractPlainTextFromRichEditorJson (ProseMirror format)", () => {
    it("extracts @username from a ProseMirror mention node", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hey " },
              { type: "mention", attrs: { userId: "u-1", username: "charlie", displayName: "Charlie" } },
              { type: "text", text: " thoughts?" },
            ],
          },
        ],
      };
      expect(extractPlainTextFromRichEditorJson(doc)).toBe("Hey @charlie thoughts?");
    });

    it("falls back to @displayName in ProseMirror when username is empty", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: { userId: "u-3", username: "", displayName: "Dana Lee" } },
            ],
          },
        ],
      };
      expect(extractPlainTextFromRichEditorJson(doc)).toBe("@Dana Lee");
    });
  });

  describe("extractPlainTextFromSerializedRichEditorContent", () => {
    it("extracts mention text from serialized BlockNote content", () => {
      const serialized = JSON.stringify([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Assigning to ", styles: {} },
            { type: "mention", props: { userId: "u-5", username: "eve", displayName: "Eve" } },
          ],
        },
      ]);
      expect(extractPlainTextFromSerializedRichEditorContent(serialized)).toBe("Assigning to @eve");
    });

    it("extracts mention text from serialized ProseMirror content", () => {
      const serialized = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: { userId: "u-6", username: "frank", displayName: "Frank" } },
            ],
          },
        ],
      });
      expect(extractPlainTextFromSerializedRichEditorContent(serialized)).toBe("@frank");
    });
  });
});
