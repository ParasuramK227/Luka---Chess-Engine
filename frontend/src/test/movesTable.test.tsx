import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MovesTable, buildRows } from "../components/MovesTable";

describe("MovesTable", () => {
  const cells = [
    { san: "e4", ply: 1 },
    { san: "e5", ply: 2 },
    { san: "Nf3", ply: 3 },
    { san: "Nc6", ply: 4 },
  ];

  it("builds numbered white/black rows", () => {
    const rows = buildRows(cells);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ num: 1 });
    expect(rows[1]).toMatchObject({ num: 2 });
  });

  it("renders SANs and handles selection clicks", () => {
    const onSelect = vi.fn();
    render(<MovesTable cells={cells} selectedPly={3} onSelect={onSelect} />);
    expect(screen.getByText("e4")).toBeInTheDocument();
    expect(screen.getByText("Nc6")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Nf3"));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("renders badges inside cells", () => {
    const withBadge = [
      { san: "Nf3", ply: 3, badge: { label: "Best", cls: "cat-best" } },
    ];
    render(<MovesTable cells={withBadge} />);
    expect(screen.getByText("Best")).toBeInTheDocument();
  });

  it("shows the empty hint", () => {
    render(<MovesTable cells={[]} />);
    expect(screen.getByText(/no moves yet/i)).toBeInTheDocument();
  });
});