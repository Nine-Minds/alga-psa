import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OVER_PREPAID_BLOCK_DEFAULT,
  PREPAID_BLOCK_FEE_DEFAULT,
  overPrepaidBlockDescription,
  prepaidBlockFeeDescription,
} from "./prepaidBlockDescriptions";

const locales = new URL("../../../../../../server/public/locales/", import.meta.url);

describe("prepaid block invoice wording", () => {
  it("renders the fee and overage text", () => {
    expect(prepaidBlockFeeDescription({ name: "Support", hours: 10 })).toBe("Support — prepaid block, 10 h");
    expect(prepaidBlockFeeDescription({ name: "Support", hours: 7.5 })).toBe("Support — prepaid block, 7.5 h");
    expect(overPrepaidBlockDescription("Support")).toBe("Support (over prepaid block)");
  });

  it("uses an injected translator", () => {
    const t = (key: string) => `<${key}>`;
    expect(overPrepaidBlockDescription("x", t)).toBe("<invoiceLines.overPrepaidBlock>");
  });

  it("keeps the in-code default equal to the en locale and defines the keys everywhere", () => {
    const en = JSON.parse(readFileSync(new URL("en/features/billing.json", locales), "utf8"));
    expect(en.invoiceLines.prepaidBlockFee).toBe(PREPAID_BLOCK_FEE_DEFAULT);
    expect(en.invoiceLines.overPrepaidBlock).toBe(OVER_PREPAID_BLOCK_DEFAULT);
    for (const lng of ["de", "es", "fr", "it", "nl", "pl", "pt", "sv", "xx", "yy"]) {
      const file = JSON.parse(readFileSync(new URL(`${lng}/features/billing.json`, locales), "utf8"));
      expect(file.invoiceLines.prepaidBlockFee).toContain("{{hours}}");
      expect(file.invoiceLines.overPrepaidBlock).toContain("{{name}}");
    }
  });
});
