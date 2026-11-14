import { describe, expect, it } from "vitest";
import { fingerprintRows } from "../utils/tableFingerprint";

describe("fingerprintRows", () => {
  const first = { config_id: "f0ec", quantity: 1, configuration_type: "Hourly" };
  const second = { config_id: "1437", quantity: 2, configuration_type: "Fixed" };
  const third = { config_id: "622a", quantity: 1, configuration_type: "Usage" };

  it("is equal for the same rows returned in a different physical order", () => {
    expect(fingerprintRows([first, second, third])).toBe(
      fingerprintRows([second, third, first]),
    );
  });

  it("is equal when a row's columns are returned in a different order", () => {
    const reordered = {
      configuration_type: "Hourly",
      quantity: 1,
      config_id: "f0ec",
    };
    expect(fingerprintRows([reordered])).toBe(fingerprintRows([first]));
  });

  it("detects a changed value, an added row, a removed row and a duplicated row", () => {
    const baseline = fingerprintRows([first, second]);
    expect(fingerprintRows([{ ...first, quantity: 3 }, second])).not.toBe(
      baseline,
    );
    expect(fingerprintRows([first, second, third])).not.toBe(baseline);
    expect(fingerprintRows([first])).not.toBe(baseline);
    expect(fingerprintRows([first, second, second])).not.toBe(
      fingerprintRows([first, first, second]),
    );
  });

  it("keeps the full row content readable in the fingerprint", () => {
    expect(JSON.parse(fingerprintRows([second, first]))).toEqual([
      { config_id: "1437", configuration_type: "Fixed", quantity: 2 },
      { config_id: "f0ec", configuration_type: "Hourly", quantity: 1 },
    ]);
  });
});
