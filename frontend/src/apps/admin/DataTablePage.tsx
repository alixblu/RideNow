/**
 * DataTablePage — generic Admin_Dashboard table destination (Req 6.3, 6.4, 6.5).
 *
 * Loads rows, then shows a search input, a table with column headers, 10-row
 * pagination, and a detail panel for the selected row. Search resets to page 1.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Input, Skeleton } from "../../shared/ui";
import { filterRows, paginate, PAGE_SIZE } from "./table";
import type { Column } from "./table";

interface DataTablePageProps<R> {
  title: string;
  columns: readonly Column<R>[];
  load: () => Promise<R[]>;
  rowKey: (row: R) => string;
  /** Detail panel heading for a row; defaults to the row key. */
  detailTitle?: (row: R) => string;
}

export function DataTablePage<R>({
  title,
  columns,
  load,
  rowKey,
  detailTitle,
}: DataTablePageProps<R>) {
  const [rows, setRows] = useState<R[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    load().then(
      (r) => {
        if (!cancelled) setRows(r);
      },
      (e: unknown) => {
        if (!cancelled) setError(e);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const filtered = useMemo(
    () => (rows ? filterRows(rows, columns, query) : []),
    [rows, columns, query],
  );
  const view = useMemo(() => paginate(filtered, page, PAGE_SIZE), [filtered, page]);
  const selected = useMemo(
    () => (rows && selectedKey !== null ? rows.find((r) => rowKey(r) === selectedKey) : undefined),
    [rows, selectedKey, rowKey],
  );

  const headingId = `${title.toLowerCase()}-heading`;
  const pageStart = filtered.length === 0 ? 0 : view.page * PAGE_SIZE + 1;
  const pageEnd = view.page * PAGE_SIZE + view.items.length;

  let body: ReactNode;
  if (error !== null) {
    body = <ErrorState error={error} onRetry={retry} />;
  } else if (rows === null) {
    body = (
      <div className="flex flex-col gap-2" data-testid="table-skeleton">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  } else if (filtered.length === 0) {
    body = (
      <EmptyState
        message={query.trim() === "" ? `No ${title.toLowerCase()} yet.` : "No rows match your search."}
        icon={<Search className="h-10 w-10" />}
        action={
          query.trim() !== "" ? (
            <Button variant="secondary" onClick={() => setQuery("")}>
              Clear search
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="text-content-muted">
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="px-4 py-3 font-semibold">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.items.map((row) => {
                const key = rowKey(row);
                const isSelected = key === selectedKey;
                return (
                  <tr
                    key={key}
                    data-testid="table-row"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => setSelectedKey(key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedKey(key);
                      }
                    }}
                    className={
                      "cursor-pointer transition-colors hover:bg-surface-raised " +
                      (isSelected ? "bg-accent/10" : "")
                    }
                  >
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-3 align-middle">
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <nav
          aria-label={`${title} pagination`}
          className="flex items-center justify-between gap-3"
        >
          <p className="text-sm text-content-muted" data-testid="page-summary">
            {pageStart}–{pageEnd} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={view.page <= 0}
              onClick={() => setPage(view.page - 1)}
            >
              Previous
            </Button>
            <span className="text-sm font-medium" data-testid="page-indicator">
              Page {view.page + 1} of {view.pageCount}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={view.page >= view.pageCount - 1}
              onClick={() => setPage(view.page + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h1 id={headingId} className="text-2xl font-extrabold">
        {title}
      </h1>
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label={`Search ${title.toLowerCase()}`}
          placeholder={`Search ${title.toLowerCase()}`}
          value={query}
          className="pl-9"
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </div>
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">{body}</div>
        {selected !== undefined ? (
          <Card
            role="complementary"
            aria-label={`${title} detail`}
            data-testid="detail-panel"
            className="w-full shrink-0 p-5 xl:w-80"
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold">
                {detailTitle ? detailTitle(selected) : rowKey(selected)}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Close detail"
                onClick={() => setSelectedKey(null)}
                leftIcon={<X className="h-4 w-4" />}
              />
            </div>
            <dl className="flex flex-col gap-3 text-sm">
              {columns.map((c) => (
                <div key={c.key} className="flex flex-col gap-0.5">
                  <dt className="text-content-muted">{c.header}</dt>
                  <dd className="font-medium">{c.cell(selected)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
