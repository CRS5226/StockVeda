import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { SortState } from "../../lib/sortRows";

interface Props<K extends string> {
  columnKey: K;
  label: string;
  sort: SortState<K> | null;
  onSort: (key: K) => void;
  right?: boolean;
  /** Extra Tailwind classes for the cell, such as wider padding. */
  className?: string;
}

/** Column title that sorts a table: a small arrow shows the direction, and a click steps through ascending, descending and off. */
export default function SortHeader<K extends string>({ columnKey, label, sort, onSort, right, className = "px-3" }: Props<K>) {
  const active = sort?.key === columnKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`${className} py-2 font-medium ${right ? "text-right" : ""}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => onSort(columnKey)} title="Sort"
        className={`inline-flex items-center gap-1 hover:text-slate-800 ${active ? "text-blue-600" : ""} ${right ? "flex-row-reverse" : ""}`}>
        {label}<Icon size={12} className={active ? "" : "opacity-40"} />
      </button>
    </th>
  );
}
