import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBoard, START_FEN } from "../state/useBoard";

function parsed(
  sanList: string[],
  start: string = "",
): Parameters<ReturnType<typeof useBoard>["loadParsedGame"]>[0] {
  return {
    start_fen: start,
    moves: sanList.map((san, i) => ({ ply: i + 1, san, uci: "", fen_before: "", fen_after: "" })),
    white: "White",
    black: "Black",
  };
}

describe("useBoard", () => {
  it("starts from the initial position", () => {
    const { result } = renderHook(() => useBoard());
    expect(result.current.fen).toBe(START_FEN);
    expect(result.current.cursor).toBe(0);
    expect(result.current.status.turn).toBe("w");
    expect(result.current.legalMoves.length).toBe(20);
  });

  it("plays a move and updates the board", () => {
    const { result } = renderHook(() => useBoard());
    act(() => {
      expect(result.current.playFromTo("e2", "e4")).toBe(true);
    });
    expect(result.current.cursor).toBe(1);
    expect(result.current.sans).toEqual(["e4"]);
    expect(result.current.status.turn).toBe("b");
  });

  it("rejects illegal moves", () => {
    const { result } = renderHook(() => useBoard());
    act(() => {
      expect(result.current.playFromTo("e2", "e5")).toBe(false);
    });
    expect(result.current.cursor).toBe(0);
  });

  it("undo/redo navigate history", () => {
    const { result } = renderHook(() => useBoard());
    act(() => {
      result.current.playFromTo("e2", "e4");
      result.current.playFromTo("e7", "e5");
    });
    expect(result.current.cursor).toBe(2);
    act(() => result.current.undo());
    expect(result.current.cursor).toBe(1);
    expect(result.current.status.turn).toBe("b");
    act(() => result.current.redo());
    expect(result.current.cursor).toBe(2);
    expect(result.current.sans).toEqual(["e4", "e5"]);
  });

  it("detects check and mate", () => {
    const { result } = renderHook(() => useBoard());
    // fool's mate
    act(() => {
      result.current.playFromTo("f2", "f3");
      result.current.playFromTo("e7", "e5");
      result.current.playFromTo("g2", "g4");
      result.current.playFromTo("d8", "h4");
    });
    expect(result.current.status.checkmate).toBe(true);
    expect(result.current.status.gameOver).toBe(true);
    expect(result.current.status.turnName).toBe("white");
  });

  it("loads a parsed game (SAN replay) and keeps history navigable", () => {
    const { result } = renderHook(() => useBoard());
    act(() => {
      result.current.loadParsedGame(
        parsed(["e4", "e5", "Nf3", "Nc6", "Bb5"]), // Ruy Lopez
      );
    });
    expect(result.current.sans).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
    expect(result.current.cursor).toBe(5);
    expect(result.current.loadedName).toBeTruthy();
    act(() => result.current.undo());
    expect(result.current.sans.length).toBe(5); // history preserved
    expect(result.current.cursor).toBe(4);
  });

  it("rejects invalid FEN", () => {
    const { result } = renderHook(() => useBoard());
    act(() => {
      expect(result.current.setFen("not a fen")).toBe(false);
    });
    expect(result.current.fen).toBe(START_FEN);
  });

  it("imports a valid FEN", () => {
    const { result } = renderHook(() => useBoard());
    const fen = "8/8/8/8/8/8/4k3/4K2R w K - 0 1";
    act(() => {
      expect(result.current.setFen(fen)).toBe(true);
    });
    expect(result.current.fen).toBe(fen);
    expect(result.current.cursor).toBe(0);
  });

  it("truncates future when moving after navigating back", () => {
    const { result } = renderHook(() => useBoard());
    act(() => {
      result.current.playFromTo("e2", "e4");
      result.current.playFromTo("e7", "e5");
      result.current.undo();
    });
    act(() => {
      result.current.playFromTo("e7", "e6");
    });
    expect(result.current.sans).toEqual(["e4", "e6"]);
    expect(result.current.cursor).toBe(2);
  });
});