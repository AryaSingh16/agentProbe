import '@testing-library/jest-dom';

// Polyfill ResizeObserver for recharts in jsdom
// @ts-ignore
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
