import "@testing-library/jest-dom/vitest";

// jsdom lacks ResizeObserver (used by recharts) and a few other APIs.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;
}

// Minimal scrollIntoView for jsdom.
if (!("scrollIntoView" in Element.prototype)) {
  (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView = () => {};
}

// Behavior needed by react-chessboard in jsdom.
window.URL.createObjectURL ??= () => "blob:mock";
window.URL.revokeObjectURL ??= () => {};