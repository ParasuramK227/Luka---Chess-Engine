import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import type { Arrow, PromotionPieceOption, Square } from "../lib/boardTypes";
import { useApp } from "../state/AppContext";
import type { EngineScore } from "../api/types";
import { EvalBar } from "./EvalBar";
import { Button, clsx, Input } from "./ui";

const LIGHT = "#f0d9b5";
const DARK = "#b58863";

export interface BoardViewProps {
  readOnly?: boolean;
  evalScore?: EngineScore | null;
  arrows?: Arrow[];
  extraSquareStyles?: Record<string, CSSProperties>;
  onSquareClick?: (square: string) => void;
  statusLine?: string;
  showControls?: boolean;
}

export function BoardView({
  readOnly = false,
  evalScore = null,
  arrows = [],
  extraSquareStyles,
  onSquareClick,
  statusLine,
  showControls = true,
}: BoardViewProps) {
  const { board, toast, settings } = useApp();
  const showCoords = settings?.board?.show_coordinates ?? true;
  const showLegalDots = settings?.board?.show_legal_moves ?? true;

  const game = useMemo(() => new Chess(board.fen), [board.fen]);
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [fenInput, setFenInput] = useState("");
  const [fenEditor, setFenEditor] = useState(false);

  const historyVerbose = useMemo(() => game.history({ verbose: true }), [game]);
  const lastMove = historyVerbose.length > 0 ? historyVerbose[historyVerbose.length - 1] : null;

  const checkSquare = useMemo<Square | null>(() => {
    if (!board.status.check) return null;
    const side = game.turn();
    for (const row of game.board()) {
      for (const cell of row) {
        if (cell && cell.type === "k" && cell.color === side) {
          return cell.square as Square;
        }
      }
    }
    return null;
  }, [game, board.status.check]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (lastMove) {
      for (const s of [lastMove.from, lastMove.to]) {
        styles[s] = { ...(styles[s] ?? {}), background: "rgba(255, 213, 0, 0.35)" };
      }
    }
    if (checkSquare) {
      styles[checkSquare] = { ...(styles[checkSquare] ?? {}), background: "radial-gradient(circle, rgba(239,68,68,0.6) 25%, rgba(239,68,68,0.15) 65%)" };
    }
    if (selected) {
      styles[selected] = { ...(styles[selected] ?? {}), background: "radial-gradient(circle, rgba(52,211,153,0.5) 0%, rgba(52,211,153,0.15) 70%)" };
      if (showLegalDots) {
        for (const m of board.legalMoves) {
          if (m.from === selected) {
            styles[m.to] = {
              ...(styles[m.to] ?? {}),
              background: "radial-gradient(circle, rgba(0,0,0,0.14) 30%, rgba(0,0,0,0.28) 68%)",
            };
          }
        }
      }
    }
    if (extraSquareStyles) {
      for (const [sq, st] of Object.entries(extraSquareStyles)) {
        styles[sq] = { ...(styles[sq] ?? {}), ...st };
      }
    }
    return styles;
  }, [lastMove, checkSquare, selected, board.legalMoves, board.fen, extraSquareStyles]);

  const needsPromotion = (from: string, to: string): boolean => {
    const piece = game.get(from as Square);
    if (!piece || piece.type !== "p") return false;
    return (piece.color === "w" && to[1] === "8") || (piece.color === "b" && to[1] === "1");
  };

  const handleSquareClick = (square: string, _piece: unknown) => {
    if (readOnly) {
      onSquareClick?.(square);
      return;
    }
    if (onSquareClick) {
      onSquareClick(square);
      return;
    }
    const clicked = game.get(square as Square);
    if (selected) {
      const move = board.legalMoves.find((m) => m.from === selected && m.to === square);
      if (move) {
        if (needsPromotion(selected, square)) {
          setPromo({ from: selected, to: square });
        } else {
          board.playFromTo(selected, square);
        }
        setSelected(null);
        return;
      }
      if (clicked && clicked.color === game.turn()) {
        setSelected(selected === square ? null : square);
      } else {
        setSelected(null);
      }
      return;
    }
    if (clicked && clicked.color === game.turn()) {
      setSelected(square);
    }
  };

  const maybeMove = (from: string, to: string): boolean => {
    if (!needsPromotion(from, to)) return board.playFromTo(from, to);
    setPromo({ from, to });
    return false;
  };

  const promoSelected = (piece?: PromotionPieceOption) => {
    if (promo && piece) {
      board.playFromTo(promo.from, promo.to, piece[1].toLowerCase());
    }
    setPromo(null);
    return true;
  };

  const tryImportFen = () => {
    if (board.setFen(fenInput.trim())) {
      toast("FEN loaded", "success");
      setFenEditor(false);
      setFenInput("");
    } else {
      toast("Invalid FEN", "error");
    }
  };

  const statusText =
    statusLine ??
    (board.status.checkmate
      ? `Checkmate — ${board.status.turnName === "white" ? "Black" : "White"} wins`
      : board.status.stalemate
        ? "Stalemate"
        : board.status.draw
          ? "Draw"
          : board.status.check
            ? `${board.status.turnName[0].toUpperCase()}${board.status.turnName.slice(1)} to move — check`
            : `${board.status.turnName[0].toUpperCase()}${board.status.turnName.slice(1)} to move`);

  return (
    <div className="flex gap-3">
      <div className="min-w-0 flex-1">
        <div className="relative">
          <Chessboard
            id="main-board"
            position={board.fen}
            boardOrientation={board.orientation}
            onPieceDrop={readOnly ? undefined : (s, t) => maybeMove(s, t)}
            onSquareClick={handleSquareClick}
            customSquareStyles={squareStyles}
            customArrows={arrows}
            areArrowsAllowed={true}
            arePiecesDraggable={!readOnly}
            showBoardNotation={showCoords}
            customDarkSquareStyle={{ backgroundColor: DARK }}
            customLightSquareStyle={{ backgroundColor: LIGHT }}
            promotionToSquare={(promo?.to as Square) ?? null}
            showPromotionDialog={promo !== null}
            onPromotionPieceSelect={promoSelected}
            autoPromoteToQueen={false}
          />
        </div>
        {showControls ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button small variant="outline" onClick={board.newGame} title="New game">
              New
            </Button>
            <Button small variant="outline" onClick={board.undo} disabled={!board.historyCanGoBack}>
              ◀
            </Button>
            <Button small variant="outline" onClick={board.redo} disabled={!board.historyCanGoForward}>
              ▶
            </Button>
            <Button small variant="outline" onClick={board.flip}>
              Flip
            </Button>
            <Button small variant="ghost" onClick={() => setFenEditor((v) => !v)}>
              FEN
            </Button>
            <Button
              small
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(board.fen).then(() => toast("FEN copied", "success"));
              }}
            >
              Copy FEN
            </Button>
            {fenEditor ? (
              <span className="flex items-center gap-1.5">
                <Input
                  className="w-72 py-1 text-xs"
                  placeholder="Paste a FEN…"
                  value={fenInput}
                  onChange={(e) => setFenInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") tryImportFen();
                  }}
                />
                <Button small variant="outline" onClick={tryImportFen}>
                  Load
                </Button>
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-2 text-xs text-stone-500">
              {board.loadedName ? <span className="truncate max-w-52" title={board.loadedName}>{board.loadedName}</span> : null}
              <span className="tabular-nums">ply {board.cursor}</span>
            </span>
          </div>
        ) : null}
        <p className={clsx("mt-1.5 text-xs", board.status.check ? "font-semibold text-red-400" : "text-stone-500")}>{statusText}</p>
      </div>
      <EvalBar evalScore={evalScore} height="100%" />
    </div>
  );
}