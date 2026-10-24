import { describe, expect, it } from "vitest";
import { classifyScannedCode } from "./scanRouting";
import { recordUrl } from "../../urls/recordLinks";

const BASE = "https://psa.example.com";
const ID = "541b5b63-9e14-47b6-a8f0-0b664f079ed4";
const PROJECT = "11111111-1111-4111-8111-111111111111";

describe("classifyScannedCode", () => {
  it.each([
    ["ticket", recordUrl("ticket", ID, BASE)],
    ["asset", recordUrl("asset", ID, BASE)],
    ["stock_unit", recordUrl("stock_unit", ID, BASE)],
    ["project_task", recordUrl("project_task", ID, BASE, { projectId: PROJECT })],
    ["project", recordUrl("project", PROJECT, BASE)],
    ["rma", recordUrl("rma", ID, BASE)],
  ])("opens a same-origin %s URL as a record", (entityType, url) => {
    const result = classifyScannedCode(url, BASE);
    expect(result.kind).toBe("record");
    if (result.kind === "record") expect(result.target.entityType).toBe(entityType);
  });

  it("normalises host case, trailing dot, default ports and scheme", () => {
    for (const url of [
      `https://PSA.Example.COM/msp/assets/${ID}`,
      `https://psa.example.com./msp/assets/${ID}`,
      `https://psa.example.com:443/msp/assets/${ID}`,
      `http://psa.example.com:80/msp/assets/${ID}`,
      `http://psa.example.com/msp/assets/${ID}`,
    ]) {
      expect(classifyScannedCode(url, BASE).kind).toBe("record");
    }
    expect(classifyScannedCode(`https://psa.example.com/msp/assets/${ID}`, "https://PSA.example.com:443/").kind).toBe(
      "record",
    );
  });

  it("keeps a non-default port significant", () => {
    expect(classifyScannedCode(`https://psa.example.com:8443/msp/assets/${ID}`, BASE).kind).toBe("foreign-record");
    expect(classifyScannedCode(`https://psa.example.com:8443/msp/assets/${ID}`, "https://psa.example.com:8443").kind).toBe(
      "record",
    );
  });

  it("flags record URLs on other origins as foreign, without trusting look-alikes", () => {
    for (const url of [
      `https://other.example.com/msp/assets/${ID}`,
      `https://psa.example.com.evil.com/msp/assets/${ID}`,
      `https://psa.example.com@evil.com/msp/assets/${ID}`,
      `https://evil.com@psa.example.com/msp/assets/${ID}`,
    ]) {
      expect(classifyScannedCode(url, BASE).kind).toBe("foreign-record");
    }
    expect(classifyScannedCode(`https://other.example.com/msp/assets/${ID}`, BASE)).toEqual({
      kind: "foreign-record",
      host: "other.example.com",
    });
  });

  it("treats every record URL as foreign when there is no connected server", () => {
    expect(classifyScannedCode(recordUrl("ticket", ID, BASE), null).kind).toBe("foreign-record");
  });

  it("leaves non-record URLs to today's lookup", () => {
    for (const url of [
      "https://psa.example.com/msp/clients",
      "https://other.example.com/anything",
      "https://psa.example.com/msp/inventory/units",
      "https://psa.example.com/msp/assets/",
    ]) {
      expect(classifyScannedCode(url, BASE)).toEqual({ kind: "code", code: url });
    }
  });

  it("leaves plain serials, GTINs and empty input as codes", () => {
    for (const code of ["0123456789012", "SN-ABC-123", "ASSET-00123", "", "   "]) {
      expect(classifyScannedCode(code, BASE)).toEqual({ kind: "code", code });
    }
  });

  it("never classifies malformed percent-encoding as a record", () => {
    expect(classifyScannedCode("https://psa.example.com/msp/assets/%E0%A4%A", BASE).kind).toBe("code");
    expect(classifyScannedCode("https://psa.example.com/msp/inventory/units?unitId=%zz", BASE).kind).toBe("code");
  });

  it("never classifies other schemes as a record", () => {
    for (const code of [
      `javascript:alert(1)//psa.example.com/msp/assets/${ID}`,
      `alga://asset/${ID}`,
      `ftp://psa.example.com/msp/assets/${ID}`,
      `//psa.example.com/msp/assets/${ID}`,
      `/msp/assets/${ID}`,
    ]) {
      expect(classifyScannedCode(code, BASE).kind).toBe("code");
    }
  });
});
