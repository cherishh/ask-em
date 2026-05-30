// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '../../../runtime/protocol';
import { OnboardingCard } from './onboarding-card';

describe('OnboardingCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderCard(
    providers: Provider[],
    enabledProviders: Provider[],
    onToggleProvider = vi.fn(),
  ) {
    act(() => {
      root.render(
        <OnboardingCard
          providers={providers}
          enabledProviders={enabledProviders}
          loading={false}
          onToggleProvider={onToggleProvider}
        />,
      );
    });

    return onToggleProvider;
  }

  it('renders only default-enabled providers with first fan-out state', () => {
    renderCard(['claude', 'chatgpt', 'gemini'], ['claude']);

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(3);
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Disable claude for first fan-out"]',
      )?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Enable gemini for first fan-out"]',
      )?.getAttribute('aria-pressed'),
    ).toBe('false');
    expect(container.textContent).not.toContain('deepseek');
  });

  it('toggles first fan-out participation instead of opening a provider tab', () => {
    const onToggleProvider = renderCard(['claude', 'chatgpt'], ['claude']);

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Enable chatgpt for first fan-out"]')
        ?.click();
    });

    expect(onToggleProvider).toHaveBeenCalledTimes(1);
    expect(onToggleProvider).toHaveBeenCalledWith('chatgpt');
  });
});
