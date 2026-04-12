// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectLoginRequired, findClickableByText, getVisibleButtonTexts } from './dom';

function mockVisibleLayout() {
  return vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => ({
      width: 120,
      height: 32,
      top: 0,
      left: 0,
      right: 120,
      bottom: 32,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }));
}

describe('adapter dom detection', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    rectSpy = mockVisibleLayout();
  });

  afterEach(() => {
    rectSpy.mockRestore();
    document.body.innerHTML = '';
  });

  it('ignores button descendants inside the ask-em injected subtree', () => {
    document.body.innerHTML = `
      <div id="ask-em-chatgpt-ui">
        <button type="button">Sign in</button>
      </div>
      <button type="button">Log in</button>
    `;

    expect(getVisibleButtonTexts()).toEqual(['Log in']);
    expect(findClickableByText('Sign in')).toBeNull();
    expect(findClickableByText('Log in')?.textContent).toBe('Log in');
  });

  it('ignores ask-em injected copy when scanning for login keywords', () => {
    document.body.innerHTML = `
      <main>
        <section>
          <p>Welcome back to Gemini.</p>
        </section>
      </main>
      <div class="ask-em-sync-shell">
        <span>sign in to sync</span>
      </div>
    `;

    expect(detectLoginRequired(['sign in'])).toBe(false);
  });
});
