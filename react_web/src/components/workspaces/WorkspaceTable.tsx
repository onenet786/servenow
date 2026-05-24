import { useMemo, useState } from "react";
import type * as React from "react";
import { Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  searchValue?: (row: T) => string;
};

type WorkspaceTableProps<T> = {
  title: string;
  description: string;
  rows: T[];
  columns: Column<T>[];
  emptyLabel?: string;
  actions?: React.ReactNode;
  searchable?: boolean;
};

export function WorkspaceTable<T>({
  title,
  description,
  rows,
  columns,
  emptyLabel = "No records found.",
  actions,
  searchable = true,
}: WorkspaceTableProps<T>) {
  const [query, setQuery] = useState("");
  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) =>
      columns.some((column) => {
        if (column.searchValue) return column.searchValue(row).toLowerCase().includes(normalized);
        const value = column.render(row);
        return String(value || "").toLowerCase().includes(normalized);
      }),
    );
  }, [columns, query, rows]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-card/80">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {searchable ? (
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-9 w-full pl-9 sm:w-64"
                  placeholder="Search records"
                />
              </label>
            ) : null}
            {actions}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className="px-4 py-2.5 font-semibold">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t hover:bg-muted/35">
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-2.5 align-top">
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr>
                  <td className="px-3 py-10 text-center text-muted-foreground" colSpan={columns.length}>
                    {rows.length ? "No records match your search." : emptyLabel}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
          <span>{filteredRows.length} shown</span>
          <span>{rows.length} total</span>
        </div>
      </CardContent>
    </Card>
  );
}
