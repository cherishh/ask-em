import type { ProviderAdapter } from '../adapters/types';
import type {
  Provider,
  ShortcutBinding,
  ShortcutConfig,
  WorkspaceContextResponseMessage,
} from '../runtime/protocol';
import { DEFAULT_SHORTCUTS, resolveShortcutConfig } from '../runtime/protocol';
import { getVisibleWorkspaceProviders } from '../runtime/workspace';
import {
  clampIndicatorPixels,
  getDefaultIndicatorPlacement,
  getPanelPlacement,
  loadIndicatorPlacement,
  pixelsToPlacement,
  placementToPixels,
  saveIndicatorPlacement,
} from './content-position';
import { renderContentTooltipHtml, type ContentTooltipSpec } from './content-tooltip';
import type { IndicatorAlertLevel, IndicatorUiState, SyncIndicatorTone } from './content-indicator';
import {
  formatBindingKeys,
  getStandaloneTooltipSpec,
  renderPillCopyHtml,
  renderWorkspacePanelHtml,
} from './content-ui-render';

export type UiState = IndicatorUiState | 'listening';

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
  onProviderTabSwitch: (direction: 'next' | 'previous') => Promise<{
    ok?: boolean;
    switched?: boolean;
    provider?: Provider;
    reason?: string;
  } | null>;
  loadWorkspaceContext: (workspaceId: string) => Promise<WorkspaceContextResponseMessage | null>;
  onRefreshContext: () => Promise<void>;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  moved: boolean;
};

const DRAG_THRESHOLD_PX = 6;
const FALLBACK_PILL_WIDTH = 260;
const FALLBACK_PILL_HEIGHT = 44;

function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  let modifierMatch: boolean;
  if (apple) {
    if (binding.meta && !binding.ctrl) {
      modifierMatch = event.metaKey && !event.ctrlKey;
    } else if (binding.ctrl && !binding.meta) {
      modifierMatch = event.metaKey && !event.ctrlKey;
    } else {
      modifierMatch = event.metaKey === binding.meta && event.ctrlKey === binding.ctrl;
    }
  } else if (binding.meta && !binding.ctrl) {
    modifierMatch = event.ctrlKey && !event.metaKey;
  } else if (binding.ctrl && !binding.meta) {
    modifierMatch = event.ctrlKey && !event.metaKey;
  } else {
    modifierMatch = event.ctrlKey === binding.ctrl && event.metaKey === binding.meta;
  }

  return (
    matchesShortcutKey(event, binding) &&
    modifierMatch &&
    event.shiftKey === binding.shift &&
    event.altKey === binding.alt
  );
}

function matchesShortcutKey(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  const eventKey = event.key.toLowerCase();
  const bindingKey = binding.key.toLowerCase();

  if (eventKey === bindingKey) {
    return true;
  }

  if (bindingKey === '.' && (event.code === 'Period' || eventKey === '>')) {
    return true;
  }

  if (bindingKey === ',' && (event.code === 'Comma' || eventKey === '<')) {
    return true;
  }

  return false;
}

export function createContentUi(adapter: ProviderAdapter, handlers: UiHandlers) {
  const { mountId, className } = adapter.getUiSpec();
  const shellId = `${mountId}-shell`;

  let shell = document.getElementById(shellId) as HTMLDivElement | null;
  if (!shell) {
    shell = document.createElement('div');
    shell.id = shellId;
    shell.className = 'ask-em-sync-shell';
    shell.dataset.dragging = 'false';
    document.body.appendChild(shell);
  }

  let panel = shell.querySelector('.ask-em-sync-panel') as HTMLDivElement | null;
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'ask-em-sync-panel';
    panel.dataset.visible = 'false';
    panel.dataset.side = 'up';
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
    mount.dataset.alertLevel = 'normal';
    mount.innerHTML = renderPillCopyHtml();
    shell.appendChild(mount);
  } else if (mount.parentElement !== shell) {
    shell.appendChild(mount);
  }

  if (!mount.querySelector('.ask-em-pill-sync')) {
    mount.dataset.syncTone = 'neutral';
    mount.dataset.alertLevel = 'normal';
    mount.innerHTML = renderPillCopyHtml();
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
  let currentPlacement = getDefaultIndicatorPlacement();
  let dragState: DragState | null = null;
  let suppressClickUntil = 0;

  const getViewportSize = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const getMountSize = () => {
    const rect = mount.getBoundingClientRect();

    return {
      width: rect.width || mount.offsetWidth || FALLBACK_PILL_WIDTH,
      height: rect.height || mount.offsetHeight || FALLBACK_PILL_HEIGHT,
    };
  };

  const closePanel = () => {
    panelPinned = false;
    panel.dataset.visible = 'false';
  };

  const applyPanelPlacement = () => {
    if (panel.dataset.visible !== 'true') {
      return;
    }

    const pillRect = mount.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const placement = getPanelPlacement(
      pillRect,
      {
        width: panelRect.width || panel.offsetWidth || 252,
        height: panelRect.height || panel.offsetHeight || 180,
      },
      getViewportSize(),
    );

    panel.dataset.side = placement.side;
    panel.style.left = `${Math.round(placement.left)}px`;
    panel.style.top = `${Math.round(placement.top)}px`;
  };

  const applyMountPixels = (left: number, top: number) => {
    mount.style.left = `${Math.round(left)}px`;
    mount.style.top = `${Math.round(top)}px`;

    if (panel.dataset.visible === 'true') {
      applyPanelPlacement();
    }
  };

  const applyPlacement = () => {
    const size = getMountSize();
    const viewport = getViewportSize();
    const pixels = placementToPixels(currentPlacement, size, viewport);
    const clampedPixels = clampIndicatorPixels(pixels, size, viewport);

    applyMountPixels(clampedPixels.left, clampedPixels.top);
  };

  const persistCurrentPlacement = async () => {
    const rect = mount.getBoundingClientRect();
    const viewport = getViewportSize();
    currentPlacement = pixelsToPlacement(
      {
        left: rect.left,
        top: rect.top,
      },
      {
        width: rect.width || FALLBACK_PILL_WIDTH,
        height: rect.height || FALLBACK_PILL_HEIGHT,
      },
      viewport,
    );
    await saveIndicatorPlacement(adapter.name, currentPlacement);
  };

  const resetPosition = async () => {
    currentPlacement = getDefaultIndicatorPlacement();
    closePanel();
    applyPlacement();
  };

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
      if (!context.globalSyncEnabled || !context.standaloneCreateSetEnabled) {
        return 'Local only';
      }

      return 'ready';
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
    const nextVisible = visible && Boolean(context.workspaceId || context.standaloneReady);
    panel.dataset.visible = String(nextVisible);

    if (nextVisible) {
      applyPanelPlacement();
    }
  };

  const renderTooltip = (spec: ContentTooltipSpec) => {
    panel.dataset.mode = 'tooltip';
    panel.innerHTML = renderContentTooltipHtml(spec);
    setPanelVisible(true);
  };

  const renderStandaloneTooltip = () => {
    renderTooltip(
      getStandaloneTooltipSpec({
        globalSyncEnabled: context.globalSyncEnabled,
        canStartNewSet: context.canStartNewSet,
        standaloneCreateSetEnabled: context.standaloneCreateSetEnabled,
        toggleShortcutKeys: formatBindingKeys(context.shortcuts.togglePageParticipation),
      }),
    );
  };

  const renderPanel = (response: WorkspaceContextResponseMessage | null) => {
    const workspaceSummary = response?.workspaceSummary;
    if (!workspaceSummary || !context.workspaceId) {
      if (context.standaloneReady && !context.workspaceId) {
        renderStandaloneTooltip();
        return;
      }

      panel.innerHTML = '';
      panel.dataset.mode = '';
      setPanelVisible(false);
      return;
    }

    panel.dataset.mode = '';
    const visibleProviders = getVisibleWorkspaceProviders(workspaceSummary.workspace);
    panel.innerHTML = renderWorkspacePanelHtml({
      response,
      currentProvider: adapter.name,
      visibleProviders,
      toggleShortcutKeys: formatBindingKeys(context.shortcuts.togglePageParticipation),
      previousShortcutKeys: formatBindingKeys(context.shortcuts.previousProviderTab),
      nextShortcutKeys: formatBindingKeys(context.shortcuts.nextProviderTab),
    });
  };

  const refreshLayout = () => {
    if (dragState?.moved) {
      return;
    }

    applyPlacement();
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
      refreshLayout();
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
    updateLabel(nextEnabled ? 'ready' : 'Local only');
    updateSyncLabel(nextEnabled ? 'Next prompt will fan out' : 'Next prompt stays here');
    refreshLayout();

    if (panel.dataset.visible === 'true' && panel.dataset.mode === 'tooltip') {
      renderStandaloneTooltip();
    }
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
    applyPanelPlacement();
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

  const handleMountClick = (event: MouseEvent) => {
    if (mount.dataset.interactive !== 'true' || Date.now() < suppressClickUntil) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (!context.workspaceId && context.standaloneReady) {
      toggleStandaloneSetCreation();
      return;
    }

    if (panelPinned) {
      closePanel();
      return;
    }

    void openPanel(true);
  };
  mount.addEventListener('click', handleMountClick);

  const handleMountMouseMove = () => {
    if (dragState || panelPinned || (!context.workspaceId && !context.standaloneReady)) {
      return;
    }

    if (context.workspaceId) {
      renderTooltip({
        message: 'Click to manage set.',
      });
      return;
    }

    renderStandaloneTooltip();
  };
  mount.addEventListener('mousemove', handleMountMouseMove);

  const handleMountMouseLeave = () => {
    if (!panelPinned) {
      setPanelVisible(false);
    }
  };
  mount.addEventListener('mouseleave', handleMountMouseLeave);

  const handleMountPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || mount.dataset.visible === 'false') {
      return;
    }

    const rect = mount.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
    mount.setPointerCapture(event.pointerId);
  };
  mount.addEventListener('pointerdown', handleMountPointerDown);

  const finishDrag = (pointerId: number) => {
    if (!dragState || dragState.pointerId !== pointerId) {
      return;
    }

    if (dragState.moved) {
      shell.dataset.dragging = 'false';
      suppressClickUntil = Date.now() + 250;
      void persistCurrentPlacement();
    }

    if (mount.hasPointerCapture(pointerId)) {
      mount.releasePointerCapture(pointerId);
    }

    dragState = null;
    shell.dataset.dragging = 'false';
  };

  const handleMountPointerMove = (event: PointerEvent) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    if (!dragState.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) {
      return;
    }

    if (!dragState.moved) {
      dragState.moved = true;
      closePanel();
      shell.dataset.dragging = 'true';
    }

    const clamped = clampIndicatorPixels(
      {
        left: dragState.startLeft + deltaX,
        top: dragState.startTop + deltaY,
      },
      getMountSize(),
      getViewportSize(),
    );

    applyMountPixels(clamped.left, clamped.top);
  };
  mount.addEventListener('pointermove', handleMountPointerMove);

  const handleMountPointerUp = (event: PointerEvent) => {
    finishDrag(event.pointerId);
  };
  mount.addEventListener('pointerup', handleMountPointerUp);
  mount.addEventListener('pointercancel', handleMountPointerUp);

  const handlePanelClick = (event: MouseEvent) => {
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
          refreshLayout();
        }
      })
      .finally(() => {
        toggle.dataset.busy = 'false';
      });
  };
  panel.addEventListener('click', handlePanelClick);

  const handleDocumentPointerDown = (event: PointerEvent) => {
    if (!panelPinned) {
      return;
    }

    if (!mount.contains(event.target as Node) && !panel.contains(event.target as Node)) {
      closePanel();
    }
  };
  document.addEventListener('pointerdown', handleDocumentPointerDown);

  const handleDocumentKeyDown = (event: KeyboardEvent) => {
    const switchDirection = matchesShortcut(event, context.shortcuts.previousProviderTab)
      ? 'previous'
      : matchesShortcut(event, context.shortcuts.nextProviderTab)
        ? 'next'
        : null;

    if (switchDirection && context.workspaceId) {
      event.preventDefault();
      event.stopPropagation();
      void handlers.onProviderTabSwitch(switchDirection).then((response) => {
        if (response?.switched === false && response.reason) {
          updateSyncLabel(response.reason, 'neutral');
          refreshLayout();
        }
      });
      return;
    }

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
  };
  document.addEventListener('keydown', handleDocumentKeyDown);

  const handleWindowResize = () => {
    applyPlacement();
  };
  window.addEventListener('resize', handleWindowResize);

  applyPlacement();
  void loadIndicatorPlacement(adapter.name).then((savedPlacement) => {
    if (!savedPlacement) {
      return;
    }

    currentPlacement = savedPlacement;
    applyPlacement();
  });

  return {
    setVisible(visible: boolean) {
      mount.dataset.visible = String(visible);
      if (!visible) {
        closePanel();
        return;
      }

      refreshLayout();
    },
    setState(state: UiState, labelText?: string) {
      mount.dataset.state = state;
      if (labelText) {
        updateLabel(labelText);
      } else {
        syncPrimaryLabel();
      }

      refreshLayout();
    },
    setSyncStatus(text: string, tone: SyncIndicatorTone = 'neutral') {
      updateSyncLabel(text, tone);
      refreshLayout();
    },
    setAlertLevel(level: IndicatorAlertLevel) {
      mount.dataset.alertLevel = level;
    },
    setContext(nextContext: UiContext) {
      context.workspaceId = nextContext.workspaceId;
      context.providerEnabled = nextContext.providerEnabled;
      context.globalSyncEnabled = nextContext.globalSyncEnabled;
      context.standaloneReady = nextContext.standaloneReady;
      context.standaloneCreateSetEnabled = nextContext.standaloneCreateSetEnabled;
      context.canStartNewSet = nextContext.canStartNewSet;
      context.shortcuts = resolveShortcutConfig(nextContext.shortcuts);
      mount.dataset.providerEnabled = String(nextContext.providerEnabled);
      mount.dataset.globalSyncEnabled = String(nextContext.globalSyncEnabled);
      mount.dataset.standaloneCreateSetEnabled = String(
        nextContext.workspaceId ? true : nextContext.standaloneCreateSetEnabled,
      );
      mount.dataset.interactive = String(Boolean(nextContext.workspaceId || nextContext.standaloneReady));

      if (!nextContext.workspaceId && !nextContext.standaloneReady) {
        closePanel();
        panel.innerHTML = '';
        panel.dataset.mode = '';
      }

      syncPrimaryLabel();
      syncStandaloneStatusLabel();
      refreshLayout();
    },
    async resetPosition() {
      await resetPosition();
    },
    destroy() {
      mount.removeEventListener('click', handleMountClick);
      mount.removeEventListener('mousemove', handleMountMouseMove);
      mount.removeEventListener('mouseleave', handleMountMouseLeave);
      mount.removeEventListener('pointerdown', handleMountPointerDown);
      mount.removeEventListener('pointermove', handleMountPointerMove);
      mount.removeEventListener('pointerup', handleMountPointerUp);
      mount.removeEventListener('pointercancel', handleMountPointerUp);
      panel.removeEventListener('click', handlePanelClick);
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
      window.removeEventListener('resize', handleWindowResize);
    },
  };
}
