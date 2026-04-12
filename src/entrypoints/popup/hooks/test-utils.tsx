// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

export function renderHookHarness<T>(useValue: () => T) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let currentValue!: T;

  function Harness() {
    currentValue = useValue();
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    get current() {
      return currentValue;
    },
    async rerender() {
      await act(async () => {
        root.render(<Harness />);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}
