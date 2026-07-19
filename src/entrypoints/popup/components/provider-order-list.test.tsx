// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderOrderList } from './provider-order-list';

describe('ProviderOrderList', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(document, 'elementFromPoint');
  });

  it('shows the drag handle without separate arrow controls', () => {
    act(() => {
      root.render(
        <ProviderOrderList
          providers={['claude', 'chatgpt', 'kimi']}
          visibleProviders={['claude', 'chatgpt', 'kimi']}
          selectedProviders={['claude']}
          loading={false}
          onToggleProvider={vi.fn()}
          onChange={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('[title="Drag kimi to reorder"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label^="Move "]')).toBeNull();
  });

  it('keeps provider selection on the same integrated row', () => {
    const onToggleProvider = vi.fn();
    act(() => {
      root.render(
        <ProviderOrderList
          providers={['kimi', 'claude', 'chatgpt']}
          visibleProviders={['kimi', 'claude', 'chatgpt']}
          selectedProviders={['claude', 'chatgpt']}
          loading={false}
          onToggleProvider={onToggleProvider}
          onChange={vi.fn()}
        />,
      );
    });

    act(() => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Add kimi from new set defaults"]',
      )?.click();
    });

    expect(onToggleProvider).toHaveBeenCalledWith('kimi');
  });

  it('reorders providers through the drag handle', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <ProviderOrderList
          providers={['claude', 'chatgpt', 'kimi']}
          visibleProviders={['claude', 'chatgpt', 'kimi']}
          selectedProviders={['claude']}
          loading={false}
          onToggleProvider={vi.fn()}
          onChange={onChange}
        />,
      );
    });

    const handle = container.querySelector<HTMLElement>('[title="Drag claude to reorder"]');
    const target = Array.from(container.querySelectorAll<HTMLDivElement>('.askem-ep-row-shell'))[1];
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 200,
      height: 40,
      top: 0,
      right: 200,
      bottom: 40,
      left: 0,
      toJSON: () => ({}),
    });
    Object.defineProperties(handle ?? {}, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
      releasePointerCapture: { value: vi.fn() },
    });
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => target),
    });
    const pointerDown = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(pointerDown, 'pointerId', { value: 1 });
    const pointerUp = new Event('pointerup', { bubbles: true });
    Object.defineProperties(pointerUp, {
      pointerId: { value: 1 },
      clientX: { value: 10 },
      clientY: { value: 30 },
    });

    act(() => handle?.dispatchEvent(pointerDown));
    act(() => handle?.dispatchEvent(pointerUp));

    expect(onChange).toHaveBeenCalledWith(['chatgpt', 'claude', 'kimi']);
  });
});
