import "@testing-library/jest-dom";

// jsdom ships no ResizeObserver; components that watch their own box (HeadBar's
// facet row) construct one on mount. A no-op stub is enough — the tests drive the
// resize-dependent state through explicit events.
if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", { writable: true, value: ResizeObserverStub });
  Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: ResizeObserverStub });
}

// jsdom ships no scrollTo on Element; RolesPanel's detail view calls it on
// mount to reset scroll position when the open role changes (issue #158's
// signin test is the first to actually render a detail, not just cards).
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { writable: true, value: () => {} });
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
