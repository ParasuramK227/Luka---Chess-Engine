import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { ErrorBoundary } from "../App";

function Bomb(): ReactElement {
  throw new Error("boom!");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("ErrorBoundary", () => {
  it("renders a recoverable fallback instead of a black screen", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/boom!/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload view/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload app/i })).toBeInTheDocument();
  });

  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>happy path</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("happy path")).toBeInTheDocument();
  });

  it("clears the error after Reload view is pressed", () => {
    const view = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();

    // Children that stopped throwing re-render once the error is cleared.
    view.rerender(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /reload view/i }));
    expect(screen.getByText("all good")).toBeInTheDocument();
  });
});