import type { ProviderAdapter } from '../adapters/types';
import type {
  GroupMemberState,
  Provider,
  ShortcutBinding,
  ShortcutConfig,
  WorkspaceContextResponseMessage,
  WorkspaceSummary,
} from '../runtime/protocol';
import { DEFAULT_SHORTCUTS } from '../runtime/protocol';
import { getVisibleWorkspaceProviders } from '../runtime/workspace';

export type UiState = 'idle' | 'listening' | 'syncing' | 'blocked';

export type SyncIndicatorTone = 'neutral' | 'success' | 'warning';

export type UiContext = {
  workspaceId: string | null;
  providerEnabled: boolean;
  globalSyncEnabled: boolean;
  standaloneReady: boolean;
  standaloneCreateSetEnabled: boolean;
  canStartNewSet: boolean;
  shortcuts: ShortcutConfig;
};

export type UiHandlers = {
  onWorkspaceProviderToggle: (provider: Provider, nextEnabled: boolean) => Promise<void>;
  onStandaloneSetCreationToggle: (nextEnabled: boolean) => void;
  loadWorkspaceContext: (workspaceId: string) => Promise<WorkspaceContextResponseMessage | null>;
  onRefreshContext: () => Promise<void>;
};

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  const apple = isApplePlatform();
  let modifierMatch: boolean;
  if (apple) {
    // On Apple: if binding has meta or ctrl (but not both), treat it as "primary modifier" = Cmd
    // If binding explicitly has ctrl only (recorded via physical Ctrl), match Ctrl exactly
    if (binding.meta && !binding.ctrl) {
      modifierMatch = event.metaKey && !event.ctrlKey;
    } else if (binding.ctrl && !binding.meta) {
      // Default shortcuts use ctrl=true for cross-platform compat → map to Cmd on Apple
      modifierMatch = event.metaKey && !event.ctrlKey;
    } else {
      modifierMatch = event.metaKey === binding.meta && event.ctrlKey === binding.ctrl;
    }
  } else {
    // On non-Apple: if binding has meta or ctrl, treat as Ctrl
    if (binding.meta && !binding.ctrl) {
      modifierMatch = event.ctrlKey && !event.metaKey;
    } else if (binding.ctrl && !binding.meta) {
      modifierMatch = event.ctrlKey && !event.metaKey;
    } else {
      modifierMatch = event.ctrlKey === binding.ctrl && event.metaKey === binding.meta;
    }
  }
  return (
    event.key.toLowerCase() === binding.key.toLowerCase() &&
    modifierMatch &&
    event.shiftKey === binding.shift &&
    event.altKey === binding.alt
  );
}

function formatBindingKeys(binding: ShortcutBinding): string[] {
  const apple = isApplePlatform();
  const keys: string[] = [];
  if (binding.ctrl || binding.meta) keys.push(apple ? 'Cmd' : 'Ctrl');
  if (binding.alt) keys.push(apple ? 'Opt' : 'Alt');
  if (binding.shift) keys.push('Shift');
  keys.push(binding.key === ' ' ? 'Space' : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return keys;
}

function renderShortcutKeysHtml(keys: string[]): string {
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

export function createContentUi(adapter: ProviderAdapter, handlers: UiHandlers) {
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
        min-height: 44px;
        padding: 10px 16px;
        border-radius: 999px;
        border: 1px solid rgba(15, 23, 42, 0.22);
        background: rgba(255, 252, 246, 0.96);
        backdrop-filter: blur(16px) saturate(1.35);
        box-shadow:
          0 14px 34px rgba(15, 23, 42, 0.18),
          inset 0 1px 0 rgba(255, 255, 255, 0.72);
        color: rgba(15, 23, 42, 0.84);
        font: 500 11px/1.1 "Avenir Next", "Segoe UI", sans-serif;
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
        flex: 0 0 auto;
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

      .ask-em-sync-pill[data-sync-tone="success"] {
        border-color: rgba(22, 163, 74, 0.26);
        background: rgba(243, 252, 245, 0.98);
        --ask-em-accent: rgba(22, 163, 74, 0.95);
      }

      .ask-em-sync-pill[data-sync-tone="warning"] {
        border-color: rgba(217, 119, 6, 0.42);
        background: rgba(255, 249, 235, 0.98);
        color: rgba(120, 53, 15, 0.94);
        --ask-em-accent: rgba(245, 158, 11, 0.98);
        box-shadow:
          0 14px 34px rgba(146, 64, 14, 0.16),
          inset 0 1px 0 rgba(255, 255, 255, 0.72);
      }

      .ask-em-sync-pill[data-provider-enabled="false"] {
        border-color: rgba(120, 113, 108, 0.2);
        background: rgba(246, 244, 241, 0.98);
        color: rgba(68, 64, 60, 0.88);
        --ask-em-accent: rgba(120, 113, 108, 0.84);
      }

      .ask-em-sync-pill[data-standalone-create-set-enabled="false"] {
        border-color: rgba(120, 113, 108, 0.2);
        background: rgba(246, 244, 241, 0.98);
        color: rgba(68, 64, 60, 0.88);
        --ask-em-accent: rgba(120, 113, 108, 0.84);
      }

      .ask-em-sync-pill[data-standalone-create-set-enabled="false"]::before {
        animation: none;
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

      .ask-em-pill-copy {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 3px;
        min-width: 0;
      }

      .ask-em-pill-label,
      .ask-em-pill-sync {
        display: block;
        max-width: 230px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ask-em-pill-label {
        line-height: 1;
      }

      .ask-em-pill-sync {
        color: rgba(82, 77, 72, 0.74);
        font: 600 10px/1.1 "Avenir Next", "Segoe UI", sans-serif;
        letter-spacing: 0;
        text-transform: none;
      }

      .ask-em-sync-pill[data-sync-tone="success"] .ask-em-pill-sync {
        color: rgba(21, 128, 61, 0.84);
      }

      .ask-em-sync-pill[data-sync-tone="warning"] .ask-em-pill-sync {
        color: rgba(146, 64, 14, 0.9);
        font-weight: 700;
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

      .ask-em-sync-panel[data-mode="tooltip"] {
        width: auto;
        max-width: 240px;
        padding: 10px 12px 11px;
        border-radius: 14px;
        border: 1px solid rgba(15, 23, 42, 0.1);
        background: rgba(255, 252, 246, 0.98);
        box-shadow:
          0 12px 26px rgba(15, 23, 42, 0.1),
          0 2px 8px rgba(15, 23, 42, 0.04);
        backdrop-filter: blur(10px) saturate(1.08);
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

      .ask-em-sync-panel[data-mode="tooltip"]::before {
        display: none;
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
        font: 700 9px/1 "Avenir Next", "Segoe UI", sans-serif;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      .ask-em-panel-title {
        margin: 0;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.3;
        letter-spacing: -0.01em;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        word-break: break-word;
      }

      .ask-em-panel-badge {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 0 8px;
        border-radius: 999px;
        background: rgba(37, 87, 214, 0.08);
        color: rgba(37, 87, 214, 0.82);
        font: 700 9px/1 "Avenir Next", "Segoe UI", sans-serif;
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

      .ask-em-sync-panel[data-mode="tooltip"] .ask-em-panel-note {
        margin: 0;
        color: rgba(53, 49, 44, 0.88);
        font: 600 13px/1.3 "Avenir Next", "Segoe UI", sans-serif;
        letter-spacing: -0.01em;
      }

      .ask-em-panel-shortcut {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid rgba(15, 23, 42, 0.08);
        color: rgba(82, 77, 72, 0.8);
        font: 600 10px/1.35 "Avenir Next", "Segoe UI", sans-serif;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .ask-em-panel-shortcut.is-standalone {
        margin-top: 10px;
        padding-top: 0;
        border-top: 0;
      }

      .ask-em-sync-panel[data-mode="tooltip"] .ask-em-panel-shortcut {
        justify-content: flex-start;
        gap: 8px;
        margin-top: 8px;
        padding-top: 0;
        border-top: 0;
        color: rgba(107, 100, 89, 0.72);
        font: 600 10px/1.2 "Avenir Next", "Segoe UI", sans-serif;
        letter-spacing: 0;
        text-transform: none;
      }

      .ask-em-sync-panel[data-mode="tooltip"] .ask-em-panel-shortcut-label {
        white-space: nowrap;
      }

      .ask-em-sync-panel[data-mode="tooltip"] .ask-em-panel-shortcut-keys {
        gap: 4px;
      }

      .ask-em-sync-panel[data-mode="tooltip"] .ask-em-panel-shortcut-plus {
        color: rgba(120, 113, 108, 0.54);
      }

      .ask-em-sync-panel[data-mode="tooltip"] .ask-em-panel-shortcut kbd {
        min-width: 18px;
        min-height: 18px;
        padding: 0 6px;
        border-radius: 6px;
        border-color: rgba(15, 23, 42, 0.1);
        background: rgba(255, 255, 255, 0.96);
        box-shadow:
          0 1px 0 rgba(255, 255, 255, 0.9),
          0 2px 4px rgba(15, 23, 42, 0.06);
        font-size: 10px;
      }

      .ask-em-panel-shortcut-keys {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }

      .ask-em-panel-shortcut-plus {
        color: rgba(107, 100, 89, 0.62);
        font: inherit;
      }

      .ask-em-panel-shortcut kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 20px;
        min-width: 20px;
        padding: 0 7px;
        border-radius: 7px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 240, 233, 0.92));
        box-shadow:
          0 1px 0 rgba(255, 255, 255, 0.92),
          0 2px 6px rgba(15, 23, 42, 0.08),
          inset 0 -1px 0 rgba(15, 23, 42, 0.06);
        color: rgba(15, 23, 42, 0.86);
        font: 700 10px/1 "Avenir Next", "Segoe UI", sans-serif;
        letter-spacing: 0.02em;
        text-transform: none;
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

      .ask-em-panel-status-dot[data-state="warning"] {
        background: rgba(245, 158, 11, 0.96);
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.14);
      }

      .ask-em-panel-status-dot[data-state="pending"] {
        background: rgba(59, 130, 246, 0.88);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .ask-em-panel-status-dot[data-state="frozen"] {
        background: rgba(120, 113, 108, 0.72);
        box-shadow: 0 0 0 3px rgba(120, 113, 108, 0.1);
      }

      .ask-em-panel-provider {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font: 700 10px/1 "Avenir Next", "Segoe UI", sans-serif;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .ask-em-panel-current {
        color: rgba(37, 87, 214, 0.78);
        font: 700 8px/1 "Avenir Next", "Segoe UI", sans-serif;
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
    mount.dataset.standaloneCreateSetEnabled = 'true';
    mount.dataset.interactive = 'false';
    mount.dataset.visible = 'false';
    mount.dataset.syncTone = 'neutral';
    mount.innerHTML = `
      <span class="ask-em-pill-copy">
        <span class="ask-em-pill-label">ready</span>
        <span class="ask-em-pill-sync">No sync yet</span>
      </span>
    `;
    shell.appendChild(mount);
  } else if (mount.parentElement !== shell) {
    shell.appendChild(mount);
  }

  if (!mount.querySelector('.ask-em-pill-sync')) {
    mount.dataset.syncTone = 'neutral';
    mount.innerHTML = `
      <span class="ask-em-pill-copy">
        <span class="ask-em-pill-label">ready</span>
        <span class="ask-em-pill-sync">No sync yet</span>
      </span>
    `;
  }

  const label = mount.querySelector('.ask-em-pill-label');
  const syncLabel = mount.querySelector('.ask-em-pill-sync');
  const context: UiContext = {
    workspaceId: null,
    providerEnabled: true,
    globalSyncEnabled: true,
    standaloneReady: false,
    standaloneCreateSetEnabled: true,
    canStartNewSet: true,
    shortcuts: DEFAULT_SHORTCUTS,
  };

  let panelPinned = false;
  let currentProviderToggleBusy = false;

  const updateLabel = (text: string) => {
    if (label) {
      label.textContent = text;
    }
  };

  const updateSyncLabel = (text: string, tone: SyncIndicatorTone = 'neutral') => {
    mount.dataset.syncTone = tone;
    if (syncLabel) {
      syncLabel.textContent = text;
    }
  };

  const getDefaultLabel = () => {
    if (!context.workspaceId) {
      if (!context.globalSyncEnabled) {
        return 'global sync off';
      }

      if (!context.canStartNewSet) {
        return 'set limit reached';
      }

      if (!context.standaloneCreateSetEnabled) {
        return 'fan-out off';
      }

      return 'fan-out on';
    }

    if (!context.globalSyncEnabled || !context.providerEnabled) {
      return 'current model sync paused';
    }

    return 'current model is in sync';
  };

  const syncPrimaryLabel = () => {
    updateLabel(getDefaultLabel());
  };

  const syncStandaloneStatusLabel = () => {
    if (context.workspaceId || !context.standaloneReady) {
      return;
    }

    if (!context.globalSyncEnabled) {
      updateSyncLabel('Prompt stays here');
      return;
    }

    if (!context.canStartNewSet) {
      updateSyncLabel('Set limit reached', 'warning');
      return;
    }

    updateSyncLabel(
      context.standaloneCreateSetEnabled ? 'Next prompt will fan out' : 'Next prompt stays here',
    );
  };

  const setPanelVisible = (visible: boolean) => {
    panel.dataset.visible = String(visible && Boolean(context.workspaceId || context.standaloneReady));
  };

  const renderTooltip = (message: string, shortcutKeys?: string[]) => {
    panel.dataset.mode = 'tooltip';
    panel.innerHTML = `
      <p class="ask-em-panel-note">${message}</p>
      ${
        shortcutKeys
          ? `<div class="ask-em-panel-shortcut is-standalone">
              <span class="ask-em-panel-shortcut-label">Shortcut</span>
              ${renderShortcutKeysHtml(shortcutKeys)}
            </div>`
          : ''
      }
    `;
    setPanelVisible(true);
  };

  const getProviderMeta = (
    provider: Provider,
    workspaceSummary: WorkspaceSummary,
    memberState: GroupMemberState,
    globalSyncEnabled: boolean,
  ) => {
    const member = workspaceSummary.workspace.members[provider];

    if (memberState === 'pending') {
      return 'connecting';
    }

    if (!member) {
      return 'not connected';
    }

    if (memberState === 'inactive') {
      return 'no live tab';
    }

    if (!globalSyncEnabled) {
      return 'frozen';
    }

    if (memberState === 'ready') {
      return 'ready';
    }

    if (memberState === 'login-required') {
      return 'needs login';
    }

    if (memberState === 'not-ready') {
      return 'loading';
    }

    if (memberState === 'stale') {
      return 'check tab';
    }

    return 'not connected';
  };

  const getProviderDotState = (
    memberState: GroupMemberState,
    globalSyncEnabled: boolean,
  ): 'active' | 'pending' | 'frozen' | 'warning' | 'inactive' => {
    if (!globalSyncEnabled && memberState === 'ready') {
      return 'frozen';
    }

    if (memberState === 'ready') {
      return 'active';
    }

    if (memberState === 'pending') {
      return 'pending';
    }

    if (memberState === 'login-required' || memberState === 'not-ready' || memberState === 'stale') {
      return 'warning';
    }

    return 'inactive';
  };

  const renderPanel = (response: WorkspaceContextResponseMessage | null) => {
    const workspaceSummary = response?.workspaceSummary;
    if (!workspaceSummary || !context.workspaceId) {
      if (context.standaloneReady && !context.workspaceId) {
        if (!context.globalSyncEnabled) {
          renderTooltip('Global sync is off in the popup.');
          return;
        }

        if (!context.canStartNewSet) {
          renderTooltip('Set limit reached. Clear a set in the popup first.');
          return;
        }

        renderTooltip(
          context.standaloneCreateSetEnabled
            ? 'Click to chat here without creating a set.'
            : 'Click to allow this chat to create a new set.',
          formatBindingKeys(context.shortcuts.togglePageParticipation),
        );
        return;
      }

      panel.innerHTML = '';
      panel.dataset.mode = '';
      setPanelVisible(false);
      return;
    }

    panel.dataset.mode = '';
    const visibleProviders = getVisibleWorkspaceProviders(workspaceSummary.workspace);
    const badgeClass = response.globalSyncEnabled ? 'ask-em-panel-badge' : 'ask-em-panel-badge is-paused';
    const badgeLabel = response.globalSyncEnabled ? 'Live Group' : 'Global Pause';
    const globalNote = response.globalSyncEnabled
      ? ''
      : '<p class="ask-em-panel-note">Freeze the world is on. Prompts stay local.</p>';

    panel.innerHTML = `
      <div class="ask-em-panel-top">
        <div>
          <p class="ask-em-panel-kicker">Current Group</p>
          <h3 class="ask-em-panel-title"></h3>
        </div>
        <span class="${badgeClass}">${badgeLabel}</span>
      </div>
      ${globalNote}
      <div class="ask-em-panel-list">
        ${visibleProviders
          .map((provider) => {
            const memberState = workspaceSummary.memberStates[provider] ?? 'inactive';
            const enabled = workspaceSummary.workspace.enabledProviders.includes(provider);
            const dotState = getProviderDotState(memberState, response.globalSyncEnabled);
            const meta = getProviderMeta(provider, workspaceSummary, memberState, response.globalSyncEnabled);
            const isCurrent = provider === adapter.name;

            return `
              <div class="ask-em-panel-row" data-current="${String(isCurrent)}">
                <div>
                  <div class="ask-em-panel-row-top">
                    <span class="ask-em-panel-status-dot" data-state="${dotState}"></span>
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
      <div class="ask-em-panel-shortcut">
        <span>Pause/restart sync for this tab</span>
        ${renderShortcutKeysHtml(formatBindingKeys(context.shortcuts.togglePageParticipation))}
      </div>
    `;

    const titleEl = panel.querySelector('.ask-em-panel-title');
    if (titleEl) {
      const label = workspaceSummary.workspace.label;
      titleEl.textContent = label
        ? label.length > 40 ? label.slice(0, 40) + '…' : label
        : '#' + workspaceSummary.workspace.id.slice(0, 8);
    }
  };

  const setCurrentProviderToggleBusy = (busy: boolean) => {
    currentProviderToggleBusy = busy;
    mount.dataset.busy = String(busy);
    const currentToggle = panel.querySelector<HTMLButtonElement>(
      `.ask-em-panel-switch[data-provider="${adapter.name}"]`,
    );

    if (currentToggle) {
      currentToggle.dataset.busy = String(busy);
    }
  };

  const toggleCurrentProvider = async () => {
    if (!context.workspaceId || currentProviderToggleBusy) {
      return;
    }

    const nextEnabled = !context.providerEnabled;
    setCurrentProviderToggleBusy(true);

    try {
      await handlers.onWorkspaceProviderToggle(adapter.name, nextEnabled);
      context.providerEnabled = nextEnabled;
      mount.dataset.providerEnabled = String(nextEnabled);
      await refreshPanel();
      updateSyncLabel(nextEnabled ? 'Ready for next prompt' : 'This tab is paused');
    } finally {
      setCurrentProviderToggleBusy(false);
    }
  };

  const toggleStandaloneSetCreation = () => {
    if (currentProviderToggleBusy || !context.globalSyncEnabled || !context.canStartNewSet) {
      return;
    }

    const nextEnabled = !context.standaloneCreateSetEnabled;
    handlers.onStandaloneSetCreationToggle(nextEnabled);
    context.standaloneCreateSetEnabled = nextEnabled;
    mount.dataset.standaloneCreateSetEnabled = String(nextEnabled);
    updateSyncLabel(nextEnabled ? 'Next prompt will fan out' : 'Next prompt stays here');
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
    syncPrimaryLabel();
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

    if (!context.workspaceId && context.standaloneReady) {
      toggleStandaloneSetCreation();
      return;
    }

    if (panelPinned) {
      panelPinned = false;
      setPanelVisible(false);
      return;
    }

    void openPanel(true);
  });

  mount.addEventListener('mousemove', () => {
    if (panelPinned || (!context.workspaceId && !context.standaloneReady)) {
      return;
    }

    if (context.workspaceId) {
      renderTooltip('Click to manage set.');
      return;
    }

    if (!context.globalSyncEnabled) {
      renderTooltip('Global sync is off in the popup.');
      return;
    }

    if (!context.canStartNewSet) {
      renderTooltip('Set limit reached. Clear a set in the popup first.');
      return;
    }

    renderTooltip(
      context.standaloneCreateSetEnabled
        ? 'Click to chat here without creating a set.'
        : 'Click to allow this chat to create a new set.',
      formatBindingKeys(context.shortcuts.togglePageParticipation),
    );
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
        }
        await refreshPanel();
        if (provider === adapter.name) {
          updateSyncLabel(nextEnabled ? 'Ready for next prompt' : 'This tab is paused');
        }
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

  document.addEventListener('keydown', (event) => {
    if (!matchesShortcut(event, context.shortcuts.togglePageParticipation)) {
      return;
    }

    if (context.workspaceId) {
      event.preventDefault();
      event.stopPropagation();
      void toggleCurrentProvider();
      return;
    }

    if (context.standaloneReady) {
      event.preventDefault();
      event.stopPropagation();
      toggleStandaloneSetCreation();
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
      if (labelText) {
        updateLabel(labelText);
        return;
      }

      syncPrimaryLabel();
    },
    setSyncStatus(text: string, tone: SyncIndicatorTone = 'neutral') {
      updateSyncLabel(text, tone);
    },
    setContext(nextContext: UiContext) {
      context.workspaceId = nextContext.workspaceId;
      context.providerEnabled = nextContext.providerEnabled;
      context.globalSyncEnabled = nextContext.globalSyncEnabled;
      context.standaloneReady = nextContext.standaloneReady;
      context.standaloneCreateSetEnabled = nextContext.standaloneCreateSetEnabled;
      context.canStartNewSet = nextContext.canStartNewSet;
      context.shortcuts = nextContext.shortcuts;
      mount.dataset.providerEnabled = String(nextContext.providerEnabled);
      mount.dataset.globalSyncEnabled = String(nextContext.globalSyncEnabled);
      mount.dataset.standaloneCreateSetEnabled = String(
        nextContext.workspaceId ? true : nextContext.standaloneCreateSetEnabled,
      );
      mount.dataset.interactive = String(Boolean(nextContext.workspaceId || nextContext.standaloneReady));

      if (!nextContext.workspaceId && !nextContext.standaloneReady) {
        panelPinned = false;
        renderPanel(null);
      }

      syncPrimaryLabel();
      syncStandaloneStatusLabel();
    },
  };
}
