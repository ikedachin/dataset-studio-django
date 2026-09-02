import { Plus, Trash2, X } from "lucide-react";

export interface FieldFilter {
  path: string;
  operator: string;
  value?: string | number;
}
const operators = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "exists",
  "missing",
  "empty",
  "not_empty",
  "gt",
  "gte",
  "lt",
  "lte",
];
export function FilterBuilder({
  filters,
  onChange,
  sort,
  direction,
  onSort,
  onClose,
}: {
  filters: FieldFilter[];
  onChange: (value: FieldFilter[]) => void;
  sort: string;
  direction: "asc" | "desc";
  onSort: (sort: string, direction: "asc" | "desc") => void;
  onClose: () => void;
}) {
  const update = (index: number, patch: Partial<FieldFilter>) =>
    onChange(
      filters.map((filter, i) =>
        i === index ? { ...filter, ...patch } : filter,
      ),
    );
  return (
    <section className="filter-popover">
      <header>
        <strong>Filter & sort</strong>
        <button className="icon-button" onClick={onClose}>
          <X />
        </button>
      </header>
      {filters.map((filter, index) => (
        <div className="filter-condition" key={index}>
          <input
            aria-label="Field path"
            placeholder="metadata.score"
            value={filter.path}
            onChange={(e) => update(index, { path: e.target.value })}
          />
          <select
            aria-label="Operator"
            value={filter.operator}
            onChange={(e) => update(index, { operator: e.target.value })}
          >
            {operators.map((op) => (
              <option key={op} value={op}>
                {op.replace("_", " ")}
              </option>
            ))}
          </select>
          {!["exists", "missing", "empty", "not_empty"].includes(
            filter.operator,
          ) && (
            <input
              aria-label="Filter value"
              placeholder="value"
              value={filter.value ?? ""}
              onChange={(e) =>
                update(index, {
                  value: ["gt", "gte", "lt", "lte"].includes(filter.operator)
                    ? Number(e.target.value)
                    : e.target.value,
                })
              }
            />
          )}
          <button
            className="icon-button danger"
            aria-label="Remove filter"
            onClick={() => onChange(filters.filter((_, i) => i !== index))}
          >
            <Trash2 />
          </button>
        </div>
      ))}
      <button
        className="secondary"
        onClick={() =>
          onChange([...filters, { path: "", operator: "equals", value: "" }])
        }
      >
        <Plus />
        Add condition
      </button>
      <div className="sort-row">
        <span>Sort by</span>
        <input
          placeholder="position (default)"
          value={sort}
          onChange={(e) => onSort(e.target.value, direction)}
        />
        <select
          value={direction}
          onChange={(e) => onSort(sort, e.target.value as "asc" | "desc")}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>
      <small>All filter conditions are combined with AND.</small>
    </section>
  );
}
