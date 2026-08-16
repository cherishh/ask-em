import { describe, expect, it } from 'vitest';
import type { WorkspaceContextResponseMessage } from '../runtime/protocol';
import { renderWorkspacePanelHtml } from './ui-render';

function createResponse(enabledProviders: Array<'claude' | 'chatgpt'>): WorkspaceContextResponseMessage {
  return {
    type: 'WORKSPACE_CONTEXT_RESPONSE',
    globalSyncEnabled: true,
    autoSyncNewChatsEnabled: true,
    workspaceSummary: {
      workspace: {
        id: 'w1',
        members: {
          claude: { provider: 'claude', sessionId: 'c-1', url: 'https://claude.ai/chat/c-1' },
          chatgpt: { provider: 'chatgpt', sessionId: 'g-1', url: 'https://chatgpt.com/c/g-1' },
        },
        enabledProviders,
        createdAt: 1,
        updatedAt: 1,
      },
      memberStates: { claude: 'ready', chatgpt: 'ready' },
      memberIssues: { claude: null, chatgpt: null },
    },
  };
}

function render(enabledProviders: Array<'claude' | 'chatgpt'>) {
  const shortcutKeys = ['Cmd', '.'];
  return renderWorkspacePanelHtml({
    response: createResponse(enabledProviders),
    currentProvider: 'claude',
    visibleProviders: ['claude', 'chatgpt'],
    toggleShortcutKeys: shortcutKeys,
    previousShortcutKeys: shortcutKeys,
    nextShortcutKeys: shortcutKeys,
  });
}

describe('workspace panel rendering', () => {
  it('renders a resume-all switch when any visible provider is paused', () => {
    const html = render(['claude']);

    expect(html).toContain('data-all-providers="true"');
    expect(html).toContain('aria-label="Resume all providers"');
    expect(html).toContain('class="ask-em-panel-switch ask-em-panel-switch-all"');
  });

  it('renders a pause-all switch when every visible provider is enabled', () => {
    const html = render(['claude', 'chatgpt']);

    expect(html).toContain('data-all-providers="true"');
    expect(html).toContain('aria-label="Pause all providers"');
  });
});
