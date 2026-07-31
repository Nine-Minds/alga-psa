import { describe, expect, it } from "vitest";
import { extractSimpleFields, isSimpleTaskForm } from "./formClassifier";

describe("isSimpleTaskForm", () => {
  it("accepts a boolean/enum/string/number confirm form", () => {
    const jsonSchema = {
      type: "object",
      required: ["approved"],
      properties: {
        approved: { type: "boolean", title: "Approve" },
        reason: { type: "string", title: "Reason" },
        priority: { type: "string", enum: ["low", "high"], title: "Priority" },
        count: { type: "number", title: "Count" },
      },
    };
    expect(isSimpleTaskForm(jsonSchema, {})).toBe(true);
  });

  it("accepts an enum-only single select with no explicit type", () => {
    const jsonSchema = {
      type: "object",
      properties: { decision: { enum: ["approve", "reject"], title: "Decision" } },
    };
    expect(isSimpleTaskForm(jsonSchema)).toBe(true);
  });

  it("rejects nested objects", () => {
    const jsonSchema = {
      type: "object",
      properties: { mapping: { type: "object", properties: { a: { type: "string" } } } },
    };
    expect(isSimpleTaskForm(jsonSchema, {})).toBe(false);
  });

  it("rejects array fields", () => {
    const jsonSchema = {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
    };
    expect(isSimpleTaskForm(jsonSchema, {})).toBe(false);
  });

  it("rejects a custom ui:widget (e.g. qbo-mapping-error highlight/button-link)", () => {
    const jsonSchema = {
      type: "object",
      properties: { ack: { type: "boolean", title: "Acknowledge" } },
    };
    const uiSchema = { ack: { "ui:widget": "button-link" } };
    expect(isSimpleTaskForm(jsonSchema, uiSchema)).toBe(false);
  });

  it("allows known-safe widgets like textarea", () => {
    const jsonSchema = {
      type: "object",
      properties: { notes: { type: "string", title: "Notes" } },
    };
    const uiSchema = { notes: { "ui:widget": "textarea" } };
    expect(isSimpleTaskForm(jsonSchema, uiSchema)).toBe(true);
  });

  it("rejects empty / missing schemas", () => {
    expect(isSimpleTaskForm(undefined)).toBe(false);
    expect(isSimpleTaskForm({ type: "object", properties: {} })).toBe(false);
  });
});

describe("extractSimpleFields", () => {
  it("maps types, required flags, enum options and defaults", () => {
    const jsonSchema = {
      type: "object",
      required: ["approved"],
      properties: {
        approved: { type: "boolean", title: "Approve", default: false },
        decision: { type: "string", enum: ["a", "b"], enumNames: ["Alpha", "Beta"], title: "Decision" },
      },
    };
    const fields = extractSimpleFields(jsonSchema, {});
    expect(fields).toHaveLength(2);

    const approved = fields.find((f) => f.name === "approved");
    expect(approved?.kind).toBe("boolean");
    expect(approved?.required).toBe(true);
    expect(approved?.defaultValue).toBe(false);

    const decision = fields.find((f) => f.name === "decision");
    expect(decision?.kind).toBe("enum");
    expect(decision?.required).toBe(false);
    expect(decision?.options).toEqual([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
  });

  it("returns no fields for a complex schema", () => {
    const jsonSchema = {
      type: "object",
      properties: { mapping: { type: "object", properties: { a: { type: "string" } } } },
    };
    expect(extractSimpleFields(jsonSchema, {})).toEqual([]);
  });
});
