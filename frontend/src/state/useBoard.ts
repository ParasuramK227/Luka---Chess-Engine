import { useCallback, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface PosRecord {
  fen: string;
  san: string;
  uci: string;
}

export interface LoadableGame {
  start_fen?: string;
  moves: { san: string }[];
  white?: string;
  black?: string;
  event?: string;
}

export interface BoardStatus {
  check: boolean;
  checkmate: boolean;
  stalemate: boolean;
  draw: boolean;
  gameOver: boolean;
  turn: "w" | "b";
  turnName: "white" | "black";
}

export interface BoardModel {
  startFen: string;
  fen: string;
  cursor: number; // index into fens
  fens: string[];
  sans: string[];
  moves: PosRecord[];
  orientation: "white" | "black";
  status: BoardStatus;
  legalMoves: { uci: string; san: string; from: string; to: string; promotion: string | null }[];
  historyCanGoBack: boolean;
  historyCanGoForward: boolean;
  loadedName: string | null;

  playFromTo: (from: string, to: string, promotion?: string) => boolean;
  undo: () => void;
  redo: () => void;
  newGame: () => void;
  resetToStart: () => void;
  setFen: (fen: string) => boolean;
  loadParsedGame: (g: LoadableGame) => void;
  navigateToPly: (ply: number) => void;
  flip: () => void;
  setOrientation: (o: "white" | "black") => void;
}

export interface PosState {
  fens: string[];
  sans: string[];
  cursor: number;
}

/** game object derived from the current cursor position */
export function gameAt(fens: string[], cursor: number): Chess {
  return new Chess(fens[Math.min(cursor, fens.length - 1)]);
}

export function useBoard(): BoardModel {
  const [startFen, setStartFen] = useState<string>(START_FEN);
  const [pos, setPos] = useState<PosState>({ fens: [START_FEN], sans: [], cursor: 0 });
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [loadedName, setLoadedName] = useState<string | null>(null);

  // A synchronous mirror of `pos` so chained actions (multiple moves in one
  // transaction/react batch) always see the latest state.
  const posRef = useRef(pos);
  posRef.current = pos;

  const commit = useCallback((next: PosState) => {
    posRef.current = next;
    setPos(next);
  }, []);

  const game = gameAt(pos.fens, pos.cursor);
  const fen = pos.fens[pos.cursor];

  const moves = useMemo<PosRecord[]>(() => {
    const rec: PosRecord[] = [];
    for (let i = 0; i < pos.fens.length - 1; i++) {
      rec.push({ fen: pos.fens[i], san: pos.sans[i], uci: "" });
    }
    return rec;
  }, [pos]);

  const status: BoardStatus = useMemo(
    () => ({
      check: game.isCheck(),
      checkmate: game.isCheckmate(),
      stalemate: game.isStalemate(),
      draw: game.isDraw(),
      gameOver: game.isGameOver(),
      turn: game.turn(),
      turnName: game.turn() === "w" ? "white" : "black",
    }),
    [game],
  );

  const legalMoves = useMemo(
    () =>
      game.moves({ verbose: true }).map((m) => ({
        uci: m.from + m.to + (m.promotion ?? ""),
        san: m.san,
        from: m.from,
        to: m.to,
        promotion: m.promotion ?? null,
      })),
    [game],
  );

  const playFromTo = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      const { fens, sans, cursor } = posRef.current;
      let g: Chess;
      try {
        g = gameAt(fens, cursor);
        const mv = g.move({ from, to, promotion });
        if (!mv) return false;
        const next: PosState = {
          fens: [...fens.slice(0, cursor + 1), g.fen()],
          sans: [...sans.slice(0, cursor), mv.san],
          cursor: cursor + 1,
        };
        commit(next);
        return true;
      } catch {
        return false;
      }
    },
    [commit],
  );

  const undo = useCallback(() => {
    const { fens, sans, cursor } = posRef.current;
    if (cursor <= 0) return;
    commit({ fens, sans, cursor: cursor - 1 });
  }, [commit]);

  const redo = useCallback(() => {
    const { fens, sans, cursor } = posRef.current;
    if (cursor >= fens.length - 1) return;
    commit({ fens, sans, cursor: cursor + 1 });
  }, [commit]);

  const resetToStart = useCallback(() => {
    const { fens, sans } = posRef.current;
    commit({ fens, sans, cursor: 0 });
  }, [commit]);

  const newGame = useCallback(() => {
    setStartFen(START_FEN);
    commit({ fens: [START_FEN], sans: [], cursor: 0 });
    setLoadedName(null);
  }, [commit]);

  const setFen = useCallback(
    (fenStr: string): boolean => {
      try {
        new Chess(fenStr);
      } catch {
        return false;
      }
      setStartFen(fenStr);
      commit({ fens: [fenStr], sans: [], cursor: 0 });
      return true;
    },
    [commit],
  );

  const loadParsedGame = useCallback(
    (g: LoadableGame) => {
      try {
        const c = new Chess(g.start_fen || START_FEN);
        const ff: string[] = [c.fen()];
        const ss: string[] = [];
        for (const m of g.moves ?? []) {
          const mv = c.move(m.san); // SAN replay is exact
          ss.push(mv.san);
          ff.push(c.fen());
        }
        setStartFen(g.start_fen || START_FEN);
        commit({ fens: ff, sans: ss, cursor: ff.length - 1 });
        setLoadedName(
          [g.white && g.white !== "?" ? g.white : null, g.black && g.black !== "?" ? g.black : null]
            .filter(Boolean)
            .join(" – ") || g.event || "loaded game",
        );
      } catch {
        /* invalid move sequence: ignore */
      }
    },
    [commit],
  );

  const navigateToPly = useCallback(
    (ply: number) => {
      const { fens, sans } = posRef.current;
      commit({ fens, sans, cursor: Math.max(0, Math.min(fens.length - 1, ply)) });
    },
    [commit],
  );

  const flip = useCallback(() => {
    setOrientation((o) => (o === "white" ? "black" : "white"));
  }, []);

  return {
    startFen,
    fen,
    cursor: pos.cursor,
    fens: pos.fens,
    sans: pos.sans,
    moves,
    orientation,
    status,
    legalMoves,
    historyCanGoBack: pos.cursor > 0,
    historyCanGoForward: pos.cursor < pos.fens.length - 1,
    loadedName,
    playFromTo,
    undo,
    redo,
    newGame,
    resetToStart,
    setFen,
    loadParsedGame,
    navigateToPly,
    flip,
    setOrientation,
  };
}