import type { ComponentProps } from "react";
import { Chessboard } from "react-chessboard";

/** Props of react-chessboard's Chessboard (it does not re-export its prop types). */
export type ChessboardProps = ComponentProps<typeof Chessboard>;

/** Types derived from ChessboardProps. */
export type Square = Parameters<NonNullable<ChessboardProps["onPieceDrop"]>>[0];
export type Arrow = NonNullable<ChessboardProps["customArrows"]>[number];
export type PromotionPieceOption = Parameters<NonNullable<ChessboardProps["onPromotionPieceSelect"]>>[0];