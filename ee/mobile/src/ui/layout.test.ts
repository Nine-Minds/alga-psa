import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));

import { describeWindow, detailSideColumnWidth, isWideWindow, listPaneWidth, useWindowLayout } from "./layout";

describe("window layout", () => {
  it("treats phones as narrow in both orientations", () => {
    expect(isWideWindow({ width: 390, height: 844 })).toBe(false);
    expect(isWideWindow({ width: 844, height: 390 })).toBe(false);
    expect(isWideWindow({ width: 440, height: 956 })).toBe(false);
  });

  it("treats tablets and opened foldables as wide in both orientations", () => {
    expect(isWideWindow({ width: 744, height: 1133 })).toBe(true); // iPad mini
    expect(isWideWindow({ width: 1133, height: 744 })).toBe(true);
    expect(isWideWindow({ width: 669, height: 951 })).toBe(true); // iPhone Duo open
  });

  it("treats a narrow Split View pane as narrow", () => {
    expect(isWideWindow({ width: 320, height: 1133 })).toBe(false);
  });

  it("splits list screens only when there is room for two useful panes", () => {
    expect(describeWindow({ width: 669, height: 951 }).splitPanes).toBe(false); // Duo portrait
    expect(describeWindow({ width: 951, height: 669 }).splitPanes).toBe(false); // Duo landscape: one full record instead
    expect(describeWindow({ width: 844, height: 390 }).splitPanes).toBe(false); // phone landscape
    expect(describeWindow({ width: 1024, height: 768 }).splitPanes).toBe(true); // iPad landscape
    expect(describeWindow({ width: 1180, height: 820 }).splitPanes).toBe(true);
  });

  it("keeps the sidebar permanent only on the widest windows", () => {
    expect(describeWindow({ width: 951, height: 669 }).permanentSidebar).toBe(false);
    expect(describeWindow({ width: 1180, height: 820 }).permanentSidebar).toBe(false); // 11" iPad: drawer + split
    expect(describeWindow({ width: 1366, height: 1024 }).permanentSidebar).toBe(true); // 13" iPad
  });

  it("sizes panes proportionally within bounds", () => {
    expect(listPaneWidth(951)).toBe(342);
    expect(listPaneWidth(700)).toBe(300);
    expect(listPaneWidth(1400)).toBe(380);
    expect(detailSideColumnWidth(720)).toBe(280);
    expect(detailSideColumnWidth(820)).toBe(312);
    expect(detailSideColumnWidth(1200)).toBe(360);
  });

  it("describes orientation alongside width class", () => {
    expect(describeWindow({ width: 844, height: 390 })).toEqual({
      width: 844,
      height: 390,
      isWide: false,
      isLandscape: true,
      splitPanes: false,
      permanentSidebar: false,
    });
    expect(useWindowLayout()).toMatchObject({ isWide: false, isLandscape: false });
  });
});
