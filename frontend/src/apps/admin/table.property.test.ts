// Feature: production-grade-frontend, Property 14: Table search filter
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { filterRows, type Column } from "./table";

interface Row {
  id: number;
  fields: string[];
}

const COLUMN_COUNT = 3;

const columns: Column<Row>[] = Array.from({ length: COLUMN_COUNT }, (_, i) => ({
  key: `c${i}`,
  header: `C${i}`,
  cell: (r: Row) => r.fields[i] as string,
  text: (r: Row) => r.fields[i] as string,
}));

const textArb = fc.string({ maxLength: 8 });

const rowsArb = fc
  .array(fc.array(textArb, { minLength: COLUMN_COUNT, maxLength: COLUMN_COUNT }), { maxLength: 30 })
  .map((all) => all.map((fields, id) => ({ id, fields })));

/** Queries: arbitrary strings, or substrings drawn from the data so matches are common. */
const queryArb = (rows: Row[]) => {
  const cells = rows.flatMap((r) => r.fields).filter((s) => s.length > 0);
  const fromData =
    cells.length === 0
      ? fc.constant("")
      : fc
          .tuple(fc.constantFrom(...cells), fc.nat(8), fc.nat(8), fc.boolean())
          .map(([s, a, b, upper]) => {
            const start = a % s.length;
            const sub = s.slice(start, start + 1 + (b % s.length));
            return upper ? sub.toUpperCase() : sub.toLowerCase();
          });
  return fc.oneof(textArb, fromData, fc.constant(""));
};

const inputArb = rowsArb.chain((rows) => queryArb(rows).map((q) => ({ rows, q })));

const matches = (row: Row, q: string) =>
  columns.some((c) => c.text(row).toLowerCase().includes(q));

describe("Property 14: Table search filter", () => {
  it("returns exactly the matching rows, in original order; empty query returns all", () => {
    fc.assert(
      fc.property(inputArb, ({ rows, q }) => {
        const result = filterRows(rows, columns, q);
        const needle = q.trim().toLowerCase();

        // Every returned row has a matching column (case-insensitive).
        for (const r of result) expect(matches(r, needle)).toBe(true);

        // Every matching row is returned, and order is preserved.
        const expected = rows.filter((r) => matches(r, needle));
        expect(result).toEqual(expected);

        // Empty query returns all rows.
        expect(filterRows(rows, columns, "")).toEqual(rows);
        if (needle === "") expect(result).toEqual(rows);
      }),
      { numRuns: 100 },
    );
  });
});
