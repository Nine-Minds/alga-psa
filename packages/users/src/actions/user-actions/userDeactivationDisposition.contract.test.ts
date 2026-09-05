import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(currentDir, "userActions.ts"), "utf8");

function sectionBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Could not find contract section ${start} -> ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

describe("deactivateUserWithDisposition contract", () => {
  const section = sectionBetween(
    "export const deactivateUserWithDisposition",
    "export const updateUserRoles",
  );

  it("keeps the work disposition and inactive update in one transaction", () => {
    expect(section).toMatch(
      /withTransaction\(\s*knex,\s*async \(trx: Knex\.Transaction\) =>/,
    );
    expect(section).toMatch(/update\(\{ is_inactive: true \}\)/);
    expect(section).toContain("where({ default_assigned_to: userId })");
  });

  it("re-keys ticket and task resources before updating the primary assignee", () => {
    const ticketPrepare = section.indexOf("prepareTicketResourceReassignment(");
    const ticketUpdate = section.search(
      /\.table\("tickets"\)[\s\S]*?\.where\(\{ ticket_id: ticket\.ticket_id \}\)[\s\S]*?\.update\(update\)/,
    );
    const taskPrepare = section.indexOf("prepareTaskResourceReassignment(");
    const taskUpdate = section.search(
      /\.table\("project_tasks"\)[\s\S]*?\.where\(\{ task_id: task\.task_id \}\)[\s\S]*?\.update\(update\)/,
    );

    expect(ticketPrepare).toBeGreaterThan(-1);
    expect(ticketUpdate).toBeGreaterThan(ticketPrepare);
    expect(taskPrepare).toBeGreaterThan(-1);
    expect(taskUpdate).toBeGreaterThan(taskPrepare);
    expect(section).toContain("await finalizeResources();");
  });

  it("uses effective status closure flags for counts and archive destinations", () => {
    expect(source).toContain('.andWhere("s.is_closed", false)');
    expect(source).toContain(
      "COALESCE(s.is_closed, ss.is_closed, false) = false",
    );
    expect(source).toContain(
      "COALESCE(s.is_closed, ss.is_closed, false) = true",
    );
  });

  it("rejects self and inactive/non-internal reassignment targets", () => {
    expect(source).toContain("userId === deactivatedUserId");
    expect(source).toContain('user_type: "internal", is_inactive: false');
  });
});
