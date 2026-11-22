import { describe, expect, it, vi } from "vitest";

import { collectFilteredPage, type PageSlice } from "./narrowedPaging";

type Row = { id: string; status: string };

function slice(items: Row[], page: number, hasNext: boolean, total = 99): PageSlice<Row> {
  return { items, page, hasNext, total };
}

describe("collectFilteredPage", () => {
  it("T122 asks once and keeps the server total when the server did the filtering", async () => {
    const loadPage = vi.fn(async (page: number) => slice([{ id: "a", status: "active" }], page, true, 42));

    const result = await collectFilteredPage<Row>({ startPage: 1, loadPage });

    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ items: [{ id: "a", status: "active" }], page: 1, hasNext: true, total: 42 });
  });

  it("T122 walks past pages that narrow to nothing and hides the unfiltered total", async () => {
    const pages: Record<number, PageSlice<Row>> = {
      1: slice([{ id: "a", status: "retired" }], 1, true),
      2: slice([{ id: "b", status: "retired" }], 2, true),
      3: slice([{ id: "c", status: "active" }], 3, true),
    };
    const loadPage = vi.fn(async (page: number) => pages[page]);

    const result = await collectFilteredPage<Row>({
      startPage: 1,
      loadPage,
      keep: (row) => row.status === "active",
    });

    expect(loadPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
    expect(result).toEqual({ items: [{ id: "c", status: "active" }], page: 3, hasNext: true, total: null });
  });

  it("T122 stops at the page budget so one scroll cannot walk the whole table", async () => {
    const loadPage = vi.fn(async (page: number) => slice([{ id: `r${page}`, status: "retired" }], page, true));

    const result = await collectFilteredPage<Row>({
      startPage: 1,
      loadPage,
      keep: (row) => row.status === "active",
      maxPages: 3,
    });

    expect(loadPage).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ items: [], page: 3, hasNext: true, total: null });
  });

  it("T122 stops on the last page even with nothing kept", async () => {
    const loadPage = vi.fn(async (page: number) => slice([{ id: "a", status: "retired" }], page, false));

    const result = await collectFilteredPage<Row>({
      startPage: 2,
      loadPage,
      keep: (row) => row.status === "active",
    });

    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ items: [], page: 2, hasNext: false, total: null });
  });

  it("T122 gives up when the caller reports a handled failure", async () => {
    const loadPage = vi.fn(async () => null);

    const result = await collectFilteredPage<Row>({ startPage: 1, loadPage, keep: () => true });

    expect(result).toBeNull();
  });
});
