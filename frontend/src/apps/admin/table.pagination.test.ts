import { describe, it } from "vitest";
import fc from "fast-check";
import { paginate, PAGE_SIZE } from "./table";

// Feature: production-grade-frontend, Property 15: Pagination partitions rows
describe("paginate (Property 15)", () => {
  const rowsArb = fc.array(fc.integer(), { maxLength: 100 });

  it("returns at most PAGE_SIZE items for any page index", () => {
    // **Validates: Requirements 6.3**
    fc.assert(
      fc.property(rowsArb, fc.integer({ min: -50, max: 50 }), (rows, page) => {
        return paginate(rows, page).items.length <= PAGE_SIZE;
      }),
    );
  });

  it("concatenating all pages reproduces the list exactly", () => {
    // **Validates: Requirements 6.3**
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const { pageCount } = paginate(rows, 0);
        const all: number[] = [];
        for (let p = 0; p < pageCount; p++) all.push(...paginate(rows, p).items);
        return JSON.stringify(all) === JSON.stringify(rows);
      }),
    );
  });

  it("clamps out-of-range page indices to a valid page", () => {
    // **Validates: Requirements 6.3**
    fc.assert(
      fc.property(rowsArb, fc.integer({ min: -1000, max: 1000 }), (rows, page) => {
        const r = paginate(rows, page);
        return r.page >= 0 && r.page <= r.pageCount - 1;
      }),
    );
  });
});
