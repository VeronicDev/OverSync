import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';

// Unmount between tests. Without this, renders accumulate in the same jsdom
// document and queries like `getByRole('button', { name: /load more/i })` match
// several leftover trees.
afterEach(() => {
  cleanup();
});

const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
};

if (typeof window !== 'undefined') {
  const storageMock = createStorageMock();
  Object.defineProperty(window, 'localStorage', {
    value: storageMock,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: storageMock,
    writable: true,
  });
}