import type { SiteAdapter } from '../adapters/types';
import type {
  GroupMemberState,
  Provider,
  WorkspaceContextResponseMessage,
  WorkspaceSummary,
} from '../runtime/protocol';

export type UiState = 'idle' | 'listening' | 'syncing' | 'blocked';

export type UiContext = {
  workspaceId: string | null;
  providerEnabled: boolean;
  globalSyncEnabled: boolean;
};

export type UiHandlers = {
  onWorkspaceProviderToggle: (provider: Provider, nextEnabled: boolean) => Promise<void>;
  loadWorkspaceContext: (workspaceId: string) => Promise<WorkspaceContextResponseMessage | null>;
  onRefreshContext: () => Promise<void>;
};

export function createContentUi(adapter: SiteAdapter, handlers: UiHandlers) {
  const { mountId, className } = adapter.getUiSpec();
  const shellId = `${mountId}-shell`;

  if (!document.getElementById('ask-em-content-style')) {
    const style = document.createElement('style');
    style.id = 'ask-em-content-style';
    style.textContent = `
      .ask-em-sync-shell {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
      }

      .ask-em-sync-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 30px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid rgba(15, 23, 42, 0.22);
        background: rgba(255, 252, 246, 0.96);
        backdrop-filter: blur(16px) saturate(1.35);
        box-shadow:
          0 14px 34px rgba(15, 23, 42, 0.18),
          inset 0 1px 0 rgba(255, 255, 255, 0.72);
        color: rgba(15, 23, 42, 0.84);
        font: 700 11px/1.1 "SF Mono", "IBM Plex Mono", Menlo, Monaco, Consolas, monospace;
        letter-spacing: 0.11em;
        text-transform: uppercase;
        opacity: 0.96;
        transition:
          opacity 180ms ease,
          border-color 180ms ease,
          color 180ms ease,
          background 180ms ease,
          box-shadow 180ms ease;
        pointer-events: auto;
        user-select: none;
        cursor: default;
      }

      .ask-em-sync-pill[data-visible="false"] {
        display: none;
      }

      .ask-em-sync-pill[data-interactive="true"] {
        cursor: pointer;
      }

      .ask-em-sync-pill:hover {
        opacity: 0.98;
      }

      .ask-em-sync-pill::before {
        content: "";
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--ask-em-accent, rgba(15, 23, 42, 0.45));
        box-shadow:
          0 0 0 2px color-mix(in srgb, var(--ask-em-accent, #0f172a) 16%, transparent),
          0 0 10px color-mix(in srgb, var(--ask-em-accent, #0f172a) 18%, transparent);
      }

      .ask-em-sync-pill[data-state="idle"] {
        --ask-em-accent: rgba(22, 163, 74, 0.95);
        border-color: rgba(22, 163, 74, 0.2);
      }

      .ask-em-sync-pill[data-state="idle"][data-provider-enabled="true"]::before,
      .ask-em-sync-pill[data-state="listening"][data-provider-enabled="true"]::before,
      .ask-em-sync-pill[data-state="syncing"][data-provider-enabled="true"]::before {
        animation: ask-em-pulse 1.2s ease-in-out infinite;
      }

      .ask-em-sync-pill[data-state="listening"] {
        border-color: rgba(22, 163, 74, 0.24);
        background: rgba(243, 252, 245, 0.97);
        --ask-em-accent: rgba(22, 163, 74, 0.95);
      }

      .ask-em-sync-pill[data-state="syncing"] {
        border-color: rgba(22, 163, 74, 0.26);
        background: rgba(241, 252, 245, 0.98);
        color: rgba(15, 23, 42, 0.92);
        --ask-em-accent: rgba(22, 163, 74, 0.95);
      }

      .ask-em-sync-pill[data-state="blocked"] {
        border-color: rgba(217, 119, 6, 0.34);
        background: rgba(255, 249, 235, 0.98);
        color: rgba(120, 53, 15, 0.9);
        --ask-em-accent: rgba(245, 158, 11, 0.96);
      }

      .ask-em-sync-pill[data-provider-enabled="false"] {
        border-color: rgba(120, 113, 108, 0.2);
        background: rgba(246, 244, 241, 0.98);
        color: rgba(68, 64, 60, 0.88);
        --ask-em-accent: rgba(120, 113, 108, 0.84);
      }

      .ask-em-sync-pill[data-global-sync-enabled="false"] {
        border-color: rgba(120, 113, 108, 0.16);
        background: rgba(236, 233, 229, 0.72);
        color: rgba(68, 64, 60, 0.76);
        box-shadow:
          0 10px 24px rgba(15, 23, 42, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
        opacity: 0.84;
        --ask-em-accent: rgba(120, 113, 108, 0.7);
      }

      .ask-em-sync-pill[data-busy="true"] {
        opacity: 0.94;
        cursor: progress;
      }

      .ask-em-pill-label {
        white-space: nowrap;
      }

      .ask-em-sync-panel {
        position: relative;
        width: 252px;
        padding: 12px;
        border-radius: 18px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        background:
          linear-gradient(180deg, rgba(255, 252, 246, 0.96), rgba(248, 243, 235, 0.94)),
          radial-gradient(circle at top right, rgba(92, 132, 255, 0.14), transparent 32%);
        backdrop-filter: blur(18px) saturate(1.28);
        box-shadow:
          0 22px 46px rgba(15, 23, 42, 0.16),
          inset 0 1px 0 rgba(255, 255, 255, 0.72);
        color: rgba(15, 23, 42, 0.88);
        opacity: 0;
        transform: translateY(8px) scale(0.98);
        transform-origin: bottom right;
        pointer-events: none;
        transition: opacity 160ms ease, transform 160ms ease;
      }

      .ask-em-sync-panel[data-visible="true"] {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }

      .ask-em-sync-panel::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background:
          repeating-linear-gradient(
            -45deg,
            rgba(92, 71, 26, 0.025) 0,
            rgba(92, 71, 26, 0.025) 10px,
            transparent 10px,
            transparent 20px
          );
        pointer-events: none;
      }

      .ask-em-sync-panel > * {
        position: relative;
      }

      .ask-em-panel-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      .ask-em-panel-kicker {
        margin: 0 0 6px;
        color: rgba(107, 100, 89, 0.92);
        font: 700 9px/1 "SF Mono", "IBM Plex Mono", Menlo, Monaco, monospace;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      .ask-em-panel-title {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
        font-size: 21px;
        line-height: 1;
        letter-spacing: -0.04em;
      }

      .ask-em-panel-badge {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 0 8px;
        border-radius: 999px;
        background: rgba(37, 87, 214, 0.08);
        color: rgba(37, 87, 214, 0.82);
        font: 700 9px/1 "SF Mono", "IBM Plex Mono", Menlo, Monaco, monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .ask-em-panel-badge.is-paused {
        background: rgba(120, 113, 108, 0.12);
        color: rgba(82, 77, 72, 0.82);
      }

      .ask-em-panel-note {
        margin: 10px 0 0;
        color: rgba(82, 77, 72, 0.84);
        font: 600 11px/1.45 "Avenir Next", "Segoe UI", sans-serif;
      }

      .ask-em-panel-list {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }

      .ask-em-panel-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        padding: 10px 10px 10px 11px;
        border-radius: 14px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        background: rgba(255, 255, 255, 0.54);
      }

      .ask-em-panel-row[data-current="true"] {
        border-color: rgba(37, 87, 214, 0.16);
        background: rgba(244, 248, 255, 0.72);
      }

      .ask-em-panel-row-top {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .ask-em-panel-status-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: rgba(120, 113, 108, 0.55);
        box-shadow: 0 0 0 3px rgba(120, 113, 108, 0.08);
      }

      .ask-em-panel-status-dot[data-state="active"] {
        background: rgba(22, 163, 74, 0.96);
        box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.12);
      }

      .ask-em-panel-status-dot[data-state="pending"] {
        background: rgba(59, 130, 246, 0.88);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .ask-em-panel-status-dot[data-state="stale"] {
        background: rgba(245, 158, 11, 0.94);
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12);
      }

      .ask-em-panel-provider {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font: 700 10px/1 "SF Mono", "IBM Plex Mono", Menlo, Monaco, monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .ask-em-panel-current {
        color: rgba(37, 87, 214, 0.78);
        font: 700 8px/1 "SF Mono", "IBM Plex Mono", Menlo, Monaco, monospace;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .ask-em-panel-meta {
        margin: 5px 0 0 15px;
        color: rgba(82, 77, 72, 0.82);
        font: 600 11px/1.4 "Avenir Next", "Segoe UI", sans-serif;
      }

      .ask-em-panel-switch {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        width: 38px;
        height: 20px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.34);
        cursor: pointer;
        transition: background 140ms ease, opacity 140ms ease;
      }

      .ask-em-panel-switch::after {
        content: "";
        position: absolute;
        left: 3px;
        width: 14px;
        height: 14px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 1px 5px rgba(15, 23, 42, 0.16);
        transition: transform 140ms ease;
      }

      .ask-em-panel-switch[data-enabled="true"] {
        background: rgba(22, 163, 74, 0.92);
      }

      .ask-em-panel-switch[data-enabled="true"]::after {
        transform: translateX(18px);
      }

      .ask-em-panel-switch[data-busy="true"] {
        opacity: 0.6;
        cursor: progress;
      }

      @keyframes ask-em-pulse {
        0%,
        100% {
          transform: scale(0.94);
          box-shadow:
            0 0 0 2px color-mix(in srgb, var(--ask-em-accent, #16a34a) 18%, transparent),
            0 0 7px color-mix(in srgb, var(--ask-em-accent, #16a34a) 14%, transparent);
        }

        50% {
          transform: scale(1.04);
          box-shadow:
            0 0 0 4px color-mix(in srgb, var(--ask-em-accent, #16a34a) 20%, transparent),
            0 0 11px color-mix(in srgb, var(--ask-em-accent, #16a34a) 20%, transparent);
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  let shell = document.getElementById(shellId) as HTMLDivElement | null;
  if (!shell) {
    shell = document.createElement('div');
    shell.id = shellId;
    shell.className = 'ask-em-sync-shell';
    document.body.appendChild(shell);
  }

  let panel = shell.querySelector('.ask-em-sync-panel') as HTMLDivElement | null;
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'ask-em-sync-panel';
    panel.dataset.visible = 'false';
    shell.appendChild(panel);
  }

  let mount = document.getElementById(mountId) as HTMLButtonElement | null;
  if (!mount) {
    mount = document.createElement('button');
    mount.type = 'button';
    mount.id = mountId;
    mount.className = className;
    mount.classList.add('ask-em-sync-pill');
    mount.dataset.state = 'idle';
    mount.dataset.providerEnabled = 'true';
    mount.dataset.globalSyncEnabled = 'true';
    mount.dataset.interactive = 'false';
    mount.dataset.visible = 'false';
    mount.innerHTML = `<span class="ask-em-pill-label">ready</span>`;
    shell.appendChild(mount);
  } else if (mount.parentElement !== shell) {
    shell.appendChild(mount);
  }

  const label = mount.querySelector('.ask-em-pill-label');
  const context: UiContext = {
    workspaceId: null,
    providerEnabled: true,
    globalSyncEnabled: true,
  };

  let panelPinned = false;

  const updateLabel = (text: string) => {
    if (label) {
      label.textContent = text;
    }
  };

  const getDefaultLabel = () =>
    !context.globalSyncEnabled
      ? 'global paused'
      : context.workspaceId
      ? context.providerEnabled ? 'sync' : 'paused'
      : 'ready';

  const setPanelVisible = (visible: boolean) => {
    panel.dataset.visible = String(visible && Boolean(context.workspaceId));
  };

  const getVisibleProviders = (workspaceSummary: WorkspaceSummary): Provider[] =>
    Array.from(
      new Set([
        ...workspaceSummary.workspace.enabledProviders,
        ...(Object.keys(workspaceSummary.workspace.members) as Provider[]),
        ...(workspaceSummary.workspace.pendingSource ? [workspaceSummary.workspace.pendingSource] : []),
      ]),
    );

  const getProviderMeta = (
    provider: Provider,
    workspaceSummary: WorkspaceSummary,
    memberState: GroupMemberState,
  ) => {
    const member = workspaceSummary.workspace.members[provider];

    if (memberState === 'pending') {
      return 'pending';
    }

    if (!member) {
      return 'not connected';
    }

    return memberState;
  };

  const renderPanel = (response: WorkspaceContextResponseMessage | null) => {
    const workspaceSummary = response?.workspaceSummary;
    if (!workspaceSummary || !context.workspaceId) {
      panel.innerHTML = '';
      setPanelVisible(false);
      return;
    }

    const visibleProviders = getVisibleProviders(workspaceSummary);
    const badgeClass = response.globalSyncEnabled ? 'ask-em-panel-badge' : 'ask-em-panel-badge is-paused';
    const badgeLabel = response.globalSyncEnabled ? 'Live Group' : 'Global Pause';
    const globalNote = response.globalSyncEnabled
      ? ''
      : '<p class="ask-em-panel-note">Global sync is paused. Changes here stay queued until sync resumes.</p>';

    panel.innerHTML = `
      <div class="ask-em-panel-top">
        <div>
          <p class="ask-em-panel-kicker">Current Group</p>
          <h3 class="ask-em-panel-title">#${workspaceSummary.workspace.id.slice(0, 8)}</h3>
        </div>
        <span class="${badgeClass}">${badgeLabel}</span>
      </div>
      ${globalNote}
      <div class="ask-em-panel-list">
        ${visibleProviders
          .map((provider) => {
            const memberState = workspaceSummary.memberStates[provider] ?? 'inactive';
            const enabled = workspaceSummary.workspace.enabledProviders.includes(provider);
            const meta = getProviderMeta(provider, workspaceSummary, memberState);
            const isCurrent = provider === adapter.name;

            return `
              <div class="ask-em-panel-row" data-current="${String(isCurrent)}">
                <div>
                  <div class="ask-em-panel-row-top">
                    <span class="ask-em-panel-status-dot" data-state="${memberState}"></span>
                    <span class="ask-em-panel-provider">
                      ${provider}
                      ${isCurrent ? '<span class="ask-em-panel-current">this tab</span>' : ''}
                    </span>
                  </div>
                  <p class="ask-em-panel-meta">${meta}</p>
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
    `;
  };

  const refreshPanel = async () => {
    if (!context.workspaceId) {
      renderPanel(null);
      return;
    }

    const response = await handlers.loadWorkspaceContext(context.workspaceId);
    if (!response?.workspaceSummary) {
      await handlers.onRefreshContext();
      renderPanel(null);
      return;
    }

    context.globalSyncEnabled = response.globalSyncEnabled;
    mount.dataset.globalSyncEnabled = String(context.globalSyncEnabled);
    updateLabel(getDefaultLabel());
    renderPanel(response);
  };

  const openPanel = async (pin = false) => {
    if (!context.workspaceId) {
      return;
    }

    if (pin) {
      panelPinned = true;
    }

    await refreshPanel();
    setPanelVisible(true);
  };

  mount.addEventListener('click', (event) => {
    if (mount.dataset.interactive !== 'true') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (panelPinned) {
      panelPinned = false;
      setPanelVisible(false);
      return;
    }

    void openPanel(true);
  });

  mount.addEventListener('mousemove', (event) => {
    if (panelPinned || !context.workspaceId) {
      return;
    }

    void openPanel(false);
  });

  shell.addEventListener('mouseleave', () => {
    if (panelPinned) {
      return;
    }

    setPanelVisible(false);
  });

  panel.addEventListener('click', (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>('.ask-em-panel-switch');
    if (!toggle || !context.workspaceId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (toggle.dataset.busy === 'true') {
      return;
    }

    toggle.dataset.busy = 'true';
    const provider = toggle.dataset.provider as Provider;
    const nextEnabled = toggle.dataset.enabled !== 'true';

    void handlers
      .onWorkspaceProviderToggle(provider, nextEnabled)
      .then(async () => {
        if (provider === adapter.name) {
          context.providerEnabled = nextEnabled;
          mount.dataset.providerEnabled = String(nextEnabled);
          updateLabel(getDefaultLabel());
        }
        await refreshPanel();
      })
      .finally(() => {
        toggle.dataset.busy = 'false';
      });
  });

  document.addEventListener('pointerdown', (event) => {
    if (!panelPinned) {
      return;
    }

    if (!shell.contains(event.target as Node)) {
      panelPinned = false;
      setPanelVisible(false);
    }
  });

  return {
    setVisible(visible: boolean) {
      mount.dataset.visible = String(visible);
      if (!visible) {
        panelPinned = false;
        setPanelVisible(false);
      }
    },
    setState(state: UiState, labelText?: string) {
      mount.dataset.state = state;
      updateLabel(labelText ?? getDefaultLabel());
    },
    setContext(nextContext: UiContext) {
      context.workspaceId = nextContext.workspaceId;
      context.providerEnabled = nextContext.providerEnabled;
      context.globalSyncEnabled = nextContext.globalSyncEnabled;
      mount.dataset.providerEnabled = String(nextContext.providerEnabled);
      mount.dataset.globalSyncEnabled = String(nextContext.globalSyncEnabled);
      mount.dataset.interactive = String(Boolean(nextContext.workspaceId));

      if (!nextContext.workspaceId) {
        panelPinned = false;
        renderPanel(null);
      }

      updateLabel(getDefaultLabel());
    },
  };
}
