// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeWorkspace } from '../../../test/builders';
import { WorkspaceCard } from './workspace-card';

describe('WorkspaceCard', () => {
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
  });

  it('uses the popup-only provider order for visible rows', () => {
    const workspace = makeWorkspace({
      id: 'w1',
      enabledProviders: ['claude', 'kimi', 'chatgpt'],
      members: {
        claude: { provider: 'claude', sessionId: 'c1', url: 'https://claude.ai/chat/c1' },
        kimi: { provider: 'kimi', sessionId: 'k1', url: 'https://www.kimi.com/chat/k1' },
        chatgpt: { provider: 'chatgpt', sessionId: 'g1', url: 'https://chatgpt.com/c/g1' },
      },
    });

    act(() => {
      root.render(
        <WorkspaceCard
          workspaceSummary={{
            workspace,
            memberStates: { claude: 'ready', kimi: 'ready', chatgpt: 'ready' },
            memberIssues: {},
          }}
          providerOrder={['kimi', 'chatgpt', 'claude', 'gemini', 'grok', 'deepseek', 'manus']}
          globalSyncEnabled
          busyKey={null}
          onClearWorkspace={vi.fn()}
          onClearProvider={vi.fn()}
        />,
      );
    });

    expect(Array.from(container.querySelectorAll('.askem-provider-name')).map(
      (element) => element.textContent,
    )).toEqual(['kimi', 'chatgpt', 'claude']);
  });
});
