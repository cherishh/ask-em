import type { Provider, ShortcutBinding, WorkspaceContextResponseMessage, WorkspaceSummary } from '../runtime/protocol';
import type { ContentTooltipSpec } from './content-tooltip';
import { getWorkspaceProviderPresentation } from './workspace-provider-display';

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function formatBindingKeys(binding: ShortcutBinding): string[] {
  const apple = isApplePlatform();
  const keys: string[] = [];
  if (binding.ctrl || binding.meta) keys.push(apple ? 'Cmd' : 'Ctrl');
  if (binding.alt) keys.push(apple ? 'Opt' : 'Alt');
  if (binding.shift) keys.push('Shift');
  keys.push(binding.key === ' ' ? 'Space' : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return keys;
}

export function renderShortcutKeysHtml(keys: string[]): string {
  return `
    <span class="ask-em-panel-shortcut-keys" aria-hidden="true">
      ${keys
        .map(
          (key, index) => `
            ${index > 0 ? '<span class="ask-em-panel-shortcut-plus">+</span>' : ''}
            <kbd>${key}</kbd>
          `,
        )
        .join('')}
    </span>
  `;
}

export function renderTooltipShortcutHtml(label: string, keys: string[]): string {
  return `
    <div class="ask-em-panel-shortcut is-standalone">
      <span class="ask-em-panel-shortcut-label">${label}</span>
      ${renderShortcutKeysHtml(keys)}
    </div>
  `;
}

export function renderPillCopyHtml(label = 'ready', syncLabel = 'next prompt stays here') {
  return `
    <span class="ask-em-pill-copy">
      <span class="ask-em-pill-label">${label}</span>
      <span class="ask-em-pill-sync">${syncLabel}</span>
    </span>
  `;
}

export function getStandaloneTooltipSpec(input: {
  globalSyncEnabled: boolean;
  canStartNewSet: boolean;
  standaloneCreateSetEnabled: boolean;
  toggleShortcutKeys: string[];
}): ContentTooltipSpec {
  if (!input.globalSyncEnabled) {
    return {
      message: 'Global sync is off in the popup.',
    };
  }

  if (!input.canStartNewSet) {
    return {
      message: 'Set limit reached. Clear a set in the popup first.',
    };
  }

  return {
    message: input.standaloneCreateSetEnabled
      ? 'Click to stop fan-out. Becomes normal single chat.'
      : 'Click to enable fan-out. Power on!',
    secondaryHtml: renderTooltipShortcutHtml('Shortcut', input.toggleShortcutKeys),
  };
}

function getWorkspaceTitle(workspaceSummary: WorkspaceSummary) {
  const label = workspaceSummary.workspace.label;
  return label
    ? label.length > 40
      ? label.slice(0, 40) + '…'
      : label
    : '#' + workspaceSummary.workspace.id.slice(0, 8);
}

export function renderWorkspacePanelHtml(input: {
  response: WorkspaceContextResponseMessage;
  currentProvider: Provider;
  visibleProviders: Provider[];
  toggleShortcutKeys: string[];
  previousShortcutKeys: string[];
  nextShortcutKeys: string[];
}) {
  const { response, currentProvider, visibleProviders } = input;
  const workspaceSummary = response.workspaceSummary;
  if (!workspaceSummary) {
    return '';
  }
  const globalNote = response.globalSyncEnabled
    ? ''
    : '<p class="ask-em-panel-note">Freeze the world is on. Prompts stay local.</p>';
  const badgeHtml = response.globalSyncEnabled
    ? ''
    : '<span class="ask-em-panel-badge is-paused">Paused</span>';

  return `
    <div class="ask-em-panel-top">
      <div>
        <p class="ask-em-panel-kicker">Current Set</p>
        <h3 class="ask-em-panel-title">${getWorkspaceTitle(workspaceSummary)}</h3>
      </div>
      ${badgeHtml}
    </div>
    ${globalNote}
    <div class="ask-em-panel-list">
      ${visibleProviders
        .map((provider) => {
          const memberState = workspaceSummary.memberStates[provider] ?? 'inactive';
          const enabled = workspaceSummary.workspace.enabledProviders.includes(provider);
          const memberIssue = workspaceSummary.memberIssues[provider] ?? null;
          const presentation = getWorkspaceProviderPresentation({
            memberState,
            memberIssue,
            enabled,
            globalSyncEnabled: response.globalSyncEnabled,
            hasMember: Boolean(workspaceSummary.workspace.members[provider]),
          });
          const isCurrent = provider === currentProvider;

          return `
            <div class="ask-em-panel-row" data-current="${String(isCurrent)}">
              <div>
                <div class="ask-em-panel-row-top">
                  <span class="ask-em-panel-status-dot" data-state="${presentation.dotState}"></span>
                  <span class="ask-em-panel-provider">
                    ${provider}
                    ${isCurrent ? '<span class="ask-em-panel-current">this tab</span>' : ''}
                  </span>
                </div>
                <p class="ask-em-panel-meta">${presentation.detail.toLowerCase()}</p>
              </div>
              <button
                type="button"
                class="ask-em-panel-switch"
                data-provider="${provider}"
                data-enabled="${String(enabled)}"
                aria-label="${enabled ? `Pause ${provider}` : `Resume ${provider}`}"
              ></button>
            </div>
          `;
        })
        .join('')}
    </div>
    <div class="ask-em-panel-shortcut">
      <span class="ask-em-panel-shortcut-label">Pause/restart sync for this tab</span>
      ${renderShortcutKeysHtml(input.toggleShortcutKeys)}
    </div>
    <div class="ask-em-panel-shortcut">
      <span class="ask-em-panel-shortcut-label">Switch tabs</span>
      <span class="ask-em-panel-shortcut-combo-group">
        ${renderShortcutKeysHtml(input.previousShortcutKeys)}
        ${renderShortcutKeysHtml(input.nextShortcutKeys)}
      </span>
    </div>
  `;
}
