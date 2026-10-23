import { describe, expect, it } from "vitest";
import { DEFAULT_PRODUCT_UNIT, PRODUCT_UNITS } from "./unitOfMeasure";
import fixture from "./unitOfMeasure.fixture.json";
import inventory from "../../i18n/locales/en/inventory.json";

describe("mobile product units", () => {
  it("match the web count-kind vocabulary (regenerate the fixture when core changes)", () => {
    expect(PRODUCT_UNITS).toEqual(fixture.countUnits);
  });

  it("default to the web product default", () => {
    expect({ code: DEFAULT_PRODUCT_UNIT.code, label: DEFAULT_PRODUCT_UNIT.label }).toEqual(fixture.productDefault);
  });

  it("have a translation for every unit label", () => {
    const labels = inventory.unitOfMeasure.labels as Record<string, string>;
    for (const unit of PRODUCT_UNITS) {
      expect(labels[unit.labelKey.replace("unitOfMeasure.labels.", "")]).toBe(unit.label);
    }
  });
});
