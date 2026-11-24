import type { ReactNode } from "react";

export interface Column<R> {
  key: string;
  header: string;
  cell: (row: R) => ReactNode;
  /** Visible text of the cell, used for search. */
  text: (row: R) => string;
}

export const PAGE_SIZE = 10;

/** Keeps rows where any column's visible text contains the query (case-insensitive, trimmed). */
export function filterRows<R>(
  rows: readonly R[],
  columns: readonly Column<R>[],
  query: string,
): R[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...rows];
  return rows.filter((row) =>
    columns.some((c) => c.text(row).toLowerCase().includes(q)),
  );
}

/** Returns one zero-based page of rows; `page` is clamped into [0, pageCount-1]. */
export function paginate<R>(
  rows: readonly R[],
  page: number,
  pageSize: number = PAGE_SIZE,
): { items: R[]; pageCount: number; page: number } {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const raw = Number.isFinite(page) ? Math.floor(page) : 0;
  const clamped = Math.min(Math.max(raw, 0), pageCount - 1);
  const start = clamped * size;
  return { items: rows.slice(start, start + size), pageCount, page: clamped };
}
