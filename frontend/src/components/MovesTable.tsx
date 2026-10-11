import { clsx } from "./ui";

export interface MoveCell {
  san: string;
  ply: number;
  badge?: { label: string; cls: string };
  title?: string;
}

export interface MoveRow {
  num: number;
  white?: MoveCell;
  black?: MoveCell;
}

export function buildRows(cells: MoveCell[]): MoveRow[] {
  const rows: MoveRow[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    rows.push({ num: Math.floor(i / 2) + 1, white: cells[i], black: cells[i + 1] });
  }
  return rows;
}

export function MovesTable({
  cells,
  selectedPly,
  onSelect,
  maxHeight = "20rem",
}: {
  cells: MoveCell[];
  selectedPly?: number | null;
  onSelect?: (ply: number) => void;
  maxHeight?: string;
}) {
  const rows = buildRows(cells.filter((c) => c.san));

  return (
    <div className="overflow-y-auto text-sm" style={{ maxHeight }}>
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row) => (
            <tr key={row.num} className="border-b border-stone-800/60 last:border-0">
              <td className="w-8 py-0.5 pr-2 text-right text-[11px] tabular-nums text-stone-600">{row.num}.</td>
              {[row.white, row.black].map((cell, idx) =>
                cell ? (
                  <td
                    key={idx}
                    onClick={() => onSelect?.(cell.ply)}
                    title={cell.title}
                    className={clsx(
                      "cursor-pointer rounded px-2 py-0.5 tabular-nums hover:bg-stone-800",
                      selectedPly === cell.ply ? "bg-violet-700/70 text-white" : "text-stone-200",
                    )}
                  >
                    <span className="inline-flex items-baseline gap-1.5">
                      {cell.san}
                      {cell.badge ? (
                        <span className={clsx("inline-block rounded px-1 py-px text-[9px] font-bold uppercase leading-none text-white", cell.badge.cls)}>
                          {cell.badge.label}
                        </span>
                      ) : null}
                    </span>
                  </td>
                ) : (
                  <td key={idx} />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-stone-600">No moves yet</div>
      ) : null}
    </div>
  );
}