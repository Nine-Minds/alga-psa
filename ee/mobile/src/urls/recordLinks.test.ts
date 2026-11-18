import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { matchRecordPath, recordPath, recordUrl } from "./recordLinks";

describe("recordLinks parity with packages/types", () => {
  it("is byte-identical to the server copy", () => {
    const mobile = readFileSync(resolve(__dirname, "recordLinks.ts"), "utf8");
    const server = readFileSync(
      resolve(__dirname, "../../../../packages/types/src/lib/recordLinks.ts"),
      "utf8",
    );
    expect(mobile).toBe(server);
  });
});

describe("recordLinks behaviour (mobile copy)", () => {
  it("round-trips a ticket and a project task", () => {
    expect(matchRecordPath(recordPath("ticket", "abc"))).toEqual({ entityType: "ticket", id: "abc" });
    expect(matchRecordPath(recordUrl("project_task", "t1", "https://x.test/", { projectId: "p1" }))).toEqual({
      entityType: "project_task",
      id: "t1",
      projectId: "p1",
    });
  });
});
