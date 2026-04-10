import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { ALL_PROVIDERS as PROVIDERS, DEFAULT_SHORTCUTS, formatShortcutDisplay } from '../../runtime/protocol';
import type {
  DebugLogEntry,
  GroupMemberState,
  Provider,
  ShortcutBinding,
  ShortcutConfig,
  ShortcutId,
  StatusResponseMessage,
  WorkspaceSummary,
} from '../../runtime/protocol';
import { getVisibleWorkspaceProviders } from '../../runtime/workspace';
import { SUPPORTED_SITES } from '../../adapters/sites';

type PopupView = 'home' | 'settings' | 'legal';
type LegalPage = 'terms' | 'privacy';

const MORE_PROVIDER_REQUEST_OPTIONS = [
  'Perplexity',
  'Grok',
  'Meta AI',
  'Mistral',
  'Qwen',
  'Kimi',
  'Doubao',
  'Poe',
] as const;

const MORE_PROVIDERS_REQUEST_ENDPOINT = '';
const MORE_PROVIDERS_REQUEST_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const MORE_PROVIDERS_REQUEST_STORAGE_KEY = 'askem-more-providers-last-submitted-at';
// TODO: wire this to the final HTTP endpoint for collecting provider requests.

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
}

function getDisplayMemberState(state: GroupMemberState): Exclude<GroupMemberState, 'stale'> {
  return state === 'stale' ? 'active' : state;
}

function getDisplayMemberStateTone(
  state: GroupMemberState,
  enabled: boolean,
): 'active' | 'inactive' | 'pending' | 'sync-paused' {
  const displayState = getDisplayMemberState(state);

  if (displayState === 'inactive' || displayState === 'pending') {
    return displayState;
  }

  if (!enabled) {
    return 'sync-paused';
  }

  return displayState;
}

function getDisplayMemberStateLabel(state: GroupMemberState, enabled: boolean): string {
  const displayState = getDisplayMemberState(state);

  if (displayState === 'inactive') {
    return 'No Live Tab';
  }

  if (displayState === 'pending') {
    return 'Connecting';
  }

  if (!enabled) {
    return 'Sync Paused';
  }

  return 'Active';
}

function getMemberOutcomeCopy(state: GroupMemberState, enabled: boolean): string {
  const displayState = getDisplayMemberState(state);

  if (displayState === 'inactive') {
    if (!enabled) {
      return 'This model has no open tab, and sync is paused, so it will not reopen on the next prompt.';
    }

    return 'Reopens on the next synced prompt';
  }

  if (displayState === 'pending') {
    return 'Waiting for this model to connect';
  }

  if (!enabled) {
    return 'Sync is paused for this model, so the next prompt will not be sent here.';
  }

  return 'Next prompt will be synced';
}

async function requestStatus(): Promise<StatusResponseMessage | null> {
  return chrome.runtime.sendMessage({ type: 'GET_STATUS' });
}

async function requestFullLogs(): Promise<DebugLogEntry[]> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_DEBUG_LOGS',
  })) as { logs?: DebugLogEntry[] } | null;

  return response?.logs ?? [];
}

function downloadJsonFile(filename: string, payload: string) {
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getMoreProvidersCooldownUntil(): number | null {
  const rawValue = window.localStorage.getItem(MORE_PROVIDERS_REQUEST_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  const submittedAt = Number(rawValue);
  if (!Number.isFinite(submittedAt)) {
    return null;
  }

  const cooldownUntil = submittedAt + MORE_PROVIDERS_REQUEST_COOLDOWN_MS;
  return cooldownUntil > Date.now() ? cooldownUntil : null;
}

function setMoreProvidersSubmittedNow() {
  window.localStorage.setItem(MORE_PROVIDERS_REQUEST_STORAGE_KEY, String(Date.now()));
}

function formatCooldownRemaining(cooldownUntil: number): string {
  const remainingMs = Math.max(0, cooldownUntil - Date.now());
  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

  if (remainingDays <= 1) {
    return 'tomorrow';
  }

  return `in ${remainingDays} days`;
}

async function submitMoreProviderRequest(requestedProviders: string[]) {
  if (!MORE_PROVIDERS_REQUEST_ENDPOINT) {
    console.info('TODO: submit more provider request', requestedProviders);
    await new Promise((resolve) => window.setTimeout(resolve, 240));
    return;
  }

  await fetch(MORE_PROVIDERS_REQUEST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requestedProviders }),
  });
}

export default function App() {
  const [activeView, setActiveView] = useState<PopupView>('home');
  const [status, setStatus] = useState<StatusResponseMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<Provider[]>(PROVIDERS);
  const [logActionBusy, setLogActionBusy] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestedProviders, setRequestedProviders] = useState<string[]>([]);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [requestCooldownUntil, setRequestCooldownUntil] = useState<number | null>(null);
  const [activeLegalPage, setActiveLegalPage] = useState<LegalPage>('terms');
  const [shortcuts, setShortcuts] = useState<ShortcutConfig>(DEFAULT_SHORTCUTS);

  const refresh = async () => {
    setLoading(true);
    const nextStatus = await requestStatus();
    startTransition(() => {
      setStatus(nextStatus);
      if (nextStatus) {
        setSelectedProviders(
          PROVIDERS.filter((provider) => nextStatus.defaultEnabledProviders[provider]),
        );
        setShortcuts(nextStatus.shortcuts ?? DEFAULT_SHORTCUTS);
      }
      setLoading(false);
    });
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 1200);

    return () => window.clearInterval(intervalId);
  }, []);

  const clearWorkspace = async (workspaceId: string) => {
    setBusyKey(workspaceId);
    await chrome.runtime.sendMessage({ type: 'CLEAR_WORKSPACE', workspaceId });
    await refresh();
    setBusyKey(null);
  };

  const clearProvider = async (workspaceId: string, provider: Provider) => {
    setBusyKey(`${workspaceId}:${provider}`);
    await chrome.runtime.sendMessage({ type: 'CLEAR_WORKSPACE_PROVIDER', workspaceId, provider });
    await refresh();
    setBusyKey(null);
  };

  const workspaceCount = status?.workspaces.length ?? 0;
  const limit = status?.workspaceLimit ?? 2;
  const atLimit = workspaceCount >= limit;
  const globalSyncEnabled = status?.globalSyncEnabled ?? true;

  const toggleDefaultProvider = async (provider: Provider) => {
    const nextProviders = selectedProviders.includes(provider)
      ? selectedProviders.filter((item) => item !== provider)
      : [...selectedProviders, provider];

    setSelectedProviders(nextProviders);
    await chrome.runtime.sendMessage({
      type: 'SET_DEFAULT_ENABLED_PROVIDERS',
      providers: nextProviders,
    });
    await refresh();
  };

  const toggleGlobalSync = async () => {
    const nextEnabled = !status?.globalSyncEnabled;
    setLoading(true);
    await chrome.runtime.sendMessage({
      type: 'SET_GLOBAL_SYNC_ENABLED',
      enabled: nextEnabled,
    });
    await refresh();
  };

  const updateShortcut = async (id: ShortcutId, binding: ShortcutBinding) => {
    const next = { ...shortcuts, [id]: binding };
    setShortcuts(next);
    await chrome.runtime.sendMessage({ type: 'SET_SHORTCUTS', shortcuts: next });
  };

  const resetShortcuts = async () => {
    setShortcuts(DEFAULT_SHORTCUTS);
    await chrome.runtime.sendMessage({ type: 'SET_SHORTCUTS', shortcuts: DEFAULT_SHORTCUTS });
  };

  const copyLogs = async () => {
    setLogActionBusy(true);
    const logs = await requestFullLogs();
    const payload = JSON.stringify(logs, null, 2);
    await navigator.clipboard.writeText(payload);
    setLogActionBusy(false);
  };

  const clearLogs = async () => {
    setLogActionBusy(true);
    await chrome.runtime.sendMessage({ type: 'CLEAR_DEBUG_LOGS' });
    await refresh();
    setLogActionBusy(false);
  };

  const toggleDebugLogging = async () => {
    const nextEnabled = !status?.debugLoggingEnabled;
    setLogActionBusy(true);
    await chrome.runtime.sendMessage({ type: 'SET_DEBUG_LOGGING_ENABLED', enabled: nextEnabled });
    await refresh();
    setLogActionBusy(false);
  };

  const downloadLogs = async () => {
    setLogActionBusy(true);
    const logs = await requestFullLogs();
    const payload = JSON.stringify(logs, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJsonFile(`ask-em-debug-logs-${timestamp}.json`, payload);
    setLogActionBusy(false);
  };

  const toggleRequestedProvider = (provider: string) => {
    setRequestedProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider],
    );
  };

  const openRequestModal = () => {
    setRequestedProviders([]);
    setRequestSubmitted(false);
    setRequestCooldownUntil(getMoreProvidersCooldownUntil());
    setRequestModalOpen(true);
  };

  const closeRequestModal = () => {
    if (requestSubmitting) {
      return;
    }

    setRequestModalOpen(false);
  };

  const submitRequestModal = async () => {
    if (requestSubmitting || requestedProviders.length === 0 || requestCooldownUntil) {
      return;
    }

    setRequestSubmitting(true);

    try {
      await submitMoreProviderRequest(requestedProviders);
      setMoreProvidersSubmittedNow();
      setRequestCooldownUntil(getMoreProvidersCooldownUntil());
      setRequestSubmitted(true);
    } finally {
      setRequestSubmitting(false);
    }
  };

  return (
    <main className="askem-popup-shell">
      <div className="askem-popup-backdrop" />
      <section className="askem-panel">
        <header className="askem-hero">
          <div className="askem-brand-block">
            <h1>ask&apos;em</h1>
            <p className="askem-slogan">One prompt, every official AI chat — full features, zero compromise.</p>
          </div>
          <div className="askem-hero-actions">
            <button
              className={`askem-sync-pill ${globalSyncEnabled ? 'is-active' : 'is-paused'}`}
              onClick={() => void toggleGlobalSync()}
              disabled={loading}
              type="button"
            >
              <span className="askem-sync-pill-label">Sync New Prompts</span>
              <strong>{globalSyncEnabled ? 'On' : 'Off'}</strong>
            </button>
            <button className="askem-refresh askem-refresh-subtle" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Syncing' : 'Refresh'}
            </button>
          </div>
        </header>

        <nav className="askem-view-tabs" aria-label="Popup sections">
          <button
            className={`askem-view-tab ${activeView === 'home' ? 'is-active' : ''}`}
            onClick={() => setActiveView('home')}
            type="button"
          >
            Home
          </button>
          <button
            className={`askem-view-tab ${activeView === 'settings' || activeView === 'legal' ? 'is-active' : ''}`}
            onClick={() => setActiveView('settings')}
            type="button"
          >
            Advanced
          </button>
        </nav>

        {activeView === 'legal' ? (
          <LegalContent
            page={activeLegalPage}
            onBack={() => setActiveView('settings')}
          />
        ) : activeView === 'home' ? (
          <>
            {atLimit ? (
              <WarningCard
                eyebrow="Heads up"
                title="Both set slots are in use."
                body="Clear a finished set below to free up a slot for your next comparison."
              />
            ) : null}

            <section className="askem-section-heading">
              <div>
                <h2>Running Sets</h2>
              </div>
              <span className="askem-section-meta">{workspaceCount}</span>
            </section>

            <section className="askem-workspaces">
              {status?.workspaces.length ? (
                status.workspaces.map((workspaceSummary) => (
                  <WorkspaceCard
                    key={workspaceSummary.workspace.id}
                    workspaceSummary={workspaceSummary}
                    busyKey={busyKey}
                    onClearWorkspace={clearWorkspace}
                    onClearProvider={clearProvider}
                  />
                ))
              ) : (
                <OnboardingCard />
              )}
            </section>
          </>
        ) : (
          <>
            <section className="askem-advanced-heading">
              <div>
                <h2>Advanced Tools</h2>
              </div>
            </section>

            <section className="askem-card askem-settings-section">
              <div className="askem-defaults-heading">
                <div className="askem-defaults-copy">
                  <p className="askem-card-label">Defaults</p>
                  <p className="askem-defaults-title">Choose which models join when a new set starts.</p>
                </div>
                <span className="askem-defaults-meta">{selectedProviders.length} selected</span>
              </div>
              <div className="askem-default-provider-list">
                {PROVIDERS.map((provider) => {
                  const active = selectedProviders.includes(provider);

                  return (
                    <button
                      key={provider}
                      className={`askem-provider-chip ${active ? 'is-active' : ''}`}
                      onClick={() => void toggleDefaultProvider(provider)}
                      disabled={loading}
                    >
                      <span className="askem-provider-chip-dot" aria-hidden="true" />
                      <span>{provider}</span>
                    </button>
                  );
                })}
              </div>
              <button className="askem-request-link" onClick={openRequestModal} type="button">
                Request more providers
              </button>
            </section>

            <ShortcutsCard
              shortcuts={shortcuts}
              onUpdateShortcut={updateShortcut}
              onResetShortcuts={resetShortcuts}
            />

            <section className="askem-card askem-logs-card">
              <div className="askem-debug-top">
                <div className="askem-debug-copy">
                  <p className="askem-card-label">Diagnostics</p>
                  <h2>Bug Report Trace</h2>
                  <p className="askem-card-copy">Turn this on only when you need to report a bug.</p>
                </div>
                <div className="askem-log-actions">
                  <button
                    className={`askem-provider-chip askem-log-toggle ${status?.debugLoggingEnabled ? 'is-active' : ''}`}
                    onClick={() => void toggleDebugLogging()}
                    disabled={logActionBusy}
                  >
                    <span>Trace</span>
                    <span>{status?.debugLoggingEnabled ? 'on' : 'off'}</span>
                  </button>
                  {status?.debugLoggingEnabled ? (
                    <>
                      <button className="askem-provider-clear" onClick={() => void copyLogs()} disabled={logActionBusy}>
                        Copy Logs
                      </button>
                      <button className="askem-provider-clear" onClick={() => void downloadLogs()} disabled={logActionBusy}>
                        Download Logs
                      </button>
                      <button className="askem-provider-clear" onClick={() => void clearLogs()} disabled={logActionBusy}>
                        Clear Logs
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              {status?.debugLoggingEnabled ? (
                <div className="askem-logs-panel">
                  <div className="askem-logs-list">
                    {status?.recentLogs.length ? (
                      status.recentLogs.map((log) => <LogRow key={log.id} log={log} />)
                    ) : (
                      <p className="askem-logs-empty">
                        Trace is on, but nothing has been captured yet.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="askem-settings-note">
                  Turn it on only when something breaks, then export the JSON file.
                </p>
              )}
            </section>

            <footer className="askem-footer">
              <span>by </span>
              <a href="https://tuxi.dev/" target="_blank" rel="noreferrer">
                Tuxi
              </a>
              <span> · one77r@gmail.com</span>
              <div className="askem-legal-links">
                <button type="button" className="askem-legal-link" onClick={() => { setActiveLegalPage('terms'); setActiveView('legal'); }}>
                  Terms of Service
                </button>
                <span className="askem-legal-sep">·</span>
                <button type="button" className="askem-legal-link" onClick={() => { setActiveLegalPage('privacy'); setActiveView('legal'); }}>
                  Privacy Policy
                </button>
              </div>
            </footer>
          </>
        )}
      </section>

      {requestModalOpen ? (
        <div className="askem-modal-overlay" onClick={closeRequestModal} role="presentation">
          <section
            className="askem-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="askem-request-modal-title"
          >
            <div className="askem-modal-top">
              <div>
                <p className="askem-card-label">Requests</p>
                <h2 id="askem-request-modal-title">Request More Providers</h2>
              </div>
              <button className="askem-modal-close" onClick={closeRequestModal} type="button">
                Close
              </button>
            </div>

            {requestSubmitted ? (
              <div className="askem-modal-state">
                <p>Thanks. Your request is in.</p>
                <span>We&apos;re on it. Stay tuned.</span>
              </div>
            ) : requestCooldownUntil ? (
              <div className="askem-modal-state">
                <p>You already sent a request recently.</p>
                <span>You can send another one {formatCooldownRemaining(requestCooldownUntil)}.</span>
              </div>
            ) : (
              <>
                <p className="askem-card-copy">
                  Pick the providers you want us to add next. Choose as many as you want.
                </p>
                <div className="askem-request-grid">
                  {MORE_PROVIDER_REQUEST_OPTIONS.map((provider) => {
                    const active = requestedProviders.includes(provider);

                    return (
                      <button
                        key={provider}
                        className={`askem-request-chip ${active ? 'is-active' : ''}`}
                        onClick={() => toggleRequestedProvider(provider)}
                        type="button"
                      >
                        <span className="askem-provider-chip-dot" aria-hidden="true" />
                        <span>{provider}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="askem-modal-actions">
                  <button className="askem-provider-clear" onClick={closeRequestModal} type="button">
                    Cancel
                  </button>
                  <button
                    className="askem-clear-workspace"
                    onClick={() => void submitRequestModal()}
                    disabled={requestSubmitting || requestedProviders.length === 0}
                    type="button"
                  >
                    {requestSubmitting ? 'Sending' : 'Send Request'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function LogRow({ log }: { log: DebugLogEntry }) {
  return (
    <div className="askem-log-row">
      <div className="askem-log-meta">
        <span className={`askem-log-level is-${log.level}`}>{log.level}</span>
        <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
        <span>{log.scope}</span>
        {log.provider ? <span>{log.provider}</span> : null}
      </div>
      <p>{log.message}</p>
      {log.detail ? <code>{log.detail}</code> : null}
    </div>
  );
}

export function WarningCard({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <section className="askem-warning-card" role="status" aria-live="polite">
      <span className="askem-warning-kicker">{eyebrow}</span>
      <div className="askem-warning-headline">
        <strong>{title}</strong>
      </div>
      <p>{body}</p>
    </section>
  );
}

// Planned: reserve this card for future premium or announcement surfaces in the popup.
export function PremiumCard({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <section className="askem-premium-card">
      <span className="askem-premium-kicker">{eyebrow}</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </section>
  );
}

function getProviderOrigin(provider: Provider): string {
  const site = SUPPORTED_SITES.find((s) => s.name === provider);
  return site?.origin ?? '#';
}

function WorkspaceCard({
  workspaceSummary,
  busyKey,
  onClearWorkspace,
  onClearProvider,
}: {
  workspaceSummary: WorkspaceSummary;
  busyKey: string | null;
  onClearWorkspace: (workspaceId: string) => Promise<void>;
  onClearProvider: (workspaceId: string, provider: Provider) => Promise<void>;
}) {
  const { workspace, memberStates } = workspaceSummary;
  const visibleProviders = getVisibleWorkspaceProviders(workspace);
  const allProvidersInactive =
    visibleProviders.length > 0 &&
    visibleProviders.every(
      (provider) => getDisplayMemberState(memberStates[provider] ?? 'inactive') === 'inactive',
    );

  const displayLabel = workspace.label
    ? workspace.label.length > 50
      ? workspace.label.slice(0, 50) + '…'
      : workspace.label
    : `Set #${workspace.id.slice(0, 8)}`;

  return (
    <article className="askem-card askem-set-card">
      <div className="askem-card-top">
        <div>
          <h2 className="askem-set-label" title={workspace.label ?? undefined}>{displayLabel}</h2>
        </div>
        <button
          className="askem-clear-workspace"
          onClick={() => void onClearWorkspace(workspace.id)}
          disabled={busyKey === workspace.id}
        >
          Delete Set
        </button>
      </div>

      <div className="askem-card-meta">
        <span>Created {formatTime(workspace.createdAt)}</span>
        <span>Updated {formatTime(workspace.updatedAt)}</span>
      </div>

      {allProvidersInactive ? (
        <p className="askem-set-lifecycle-note">
          All tabs are closed. This set will clear itself soon.
        </p>
      ) : null}

      <div className="askem-provider-grid">
        {visibleProviders.map((provider) => {
          const member = workspace.members[provider];
          const enabled = workspace.enabledProviders.includes(provider);
          const rawState = memberStates[provider] ?? 'inactive';
          const stateTone = getDisplayMemberStateTone(rawState, enabled);
          const stateLabel = getDisplayMemberStateLabel(rawState, enabled);
          const outcomeCopy = getMemberOutcomeCopy(rawState, enabled);
          const displayState = getDisplayMemberState(rawState);
          const showOpenLink = displayState === 'inactive' && !member?.sessionId;

          return (
            <div className="askem-provider-row" key={`${workspace.id}:${provider}`}>
              <div className="askem-provider-main">
                <span className="askem-provider-name">{provider}</span>
                <div className="askem-provider-statusline">
                  <span className={`askem-state askem-state-${stateTone}`}>{stateLabel}</span>
                  {showOpenLink ? (
                    <a
                      className="askem-provider-open-link"
                      href={getProviderOrigin(provider)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        e.preventDefault();
                        void chrome.tabs.create({ url: getProviderOrigin(provider) });
                      }}
                    >
                      Open {provider}
                    </a>
                  ) : (
                    <span className="askem-provider-subcopy">{outcomeCopy}</span>
                  )}
                </div>
              </div>
              <div className="askem-provider-actions">
                <button
                  className="askem-provider-clear"
                  onClick={() => void onClearProvider(workspace.id, provider)}
                  disabled={busyKey === `${workspace.id}:${provider}`}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

const SHORTCUT_ROWS = [
  {
    id: 'togglePageParticipation',
    label: 'Toggle this page in ask’em',
  },
] as const satisfies Array<{ id: ShortcutId; label: string }>;

function ShortcutRecorder({
  binding,
  onRecord,
  conflict,
}: {
  binding: ShortcutBinding;
  onRecord: (binding: ShortcutBinding) => void;
  conflict: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!recording) return;

      // Ignore bare modifier presses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;

      // Require at least one modifier
      if (!event.metaKey && !event.ctrlKey && !event.altKey) return;

      event.preventDefault();
      event.stopPropagation();

      const newBinding: ShortcutBinding = {
        key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
      };

      onRecord(newBinding);
      setRecording(false);
    },
    [recording, onRecord],
  );

  useEffect(() => {
    if (!recording) return;
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, handleKeyDown]);

  useEffect(() => {
    if (!recording) return;
    const handleBlur = () => setRecording(false);
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [recording]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`askem-shortcut-keys askem-shortcut-recorder ${recording ? 'is-recording' : ''} ${conflict ? 'is-conflict' : ''}`}
      onClick={() => setRecording(!recording)}
    >
      {recording ? 'Press keys…' : formatShortcutDisplay(binding, isApple)}
    </button>
  );
}

function ShortcutsCard({
  shortcuts,
  onUpdateShortcut,
  onResetShortcuts,
}: {
  shortcuts: ShortcutConfig;
  onUpdateShortcut: (id: ShortcutId, binding: ShortcutBinding) => Promise<void>;
  onResetShortcuts: () => Promise<void>;
}) {
  const isDefault =
    JSON.stringify(shortcuts) === JSON.stringify(DEFAULT_SHORTCUTS);

  const handleRecord = (id: ShortcutId, binding: ShortcutBinding) => {
    void onUpdateShortcut(id, binding);
  };

  const handleReset = () => {
    void onResetShortcuts();
  };

  return (
    <section className="askem-card askem-settings-section">
      <div className="askem-defaults-heading">
        <div className="askem-defaults-copy">
          <p className="askem-card-label">Shortcuts</p>
          <p className="askem-defaults-title">Keyboard shortcuts used in chat pages.</p>
        </div>
        {!isDefault && (
          <button
            type="button"
            className="askem-provider-clear"
            onClick={handleReset}
          >
            Reset
          </button>
        )}
      </div>
      <div className="askem-shortcut-list">
        {SHORTCUT_ROWS.map(({ id, label }) => (
          <div className="askem-shortcut-row" key={id}>
            <span className="askem-shortcut-action">{label}</span>
            <ShortcutRecorder
              binding={shortcuts[id]}
              onRecord={(binding) => handleRecord(id, binding)}
              conflict={false}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function OnboardingCard() {
  const openProvider = (provider: Provider) => {
    const origin = getProviderOrigin(provider);
    void chrome.tabs.create({ url: origin });
  };

  return (
    <div className="askem-onboarding">
      <div className="askem-onboarding-header">
        <span className="askem-onboarding-step">Get Started</span>
        <p className="askem-onboarding-title">Ask every AI at once</p>
      </div>
      <div className="askem-onboarding-body">
        <p className="askem-onboarding-desc">
          ask&apos;em uses official chat interfaces so you get the full experience — artifacts, web search, file uploads, and all features each provider offers.
        </p>
        <div className="askem-onboarding-steps">
          <div className="askem-onboarding-step-item">
            <span className="askem-onboarding-num">1</span>
            <span>Open any AI chat below</span>
          </div>
          <div className="askem-onboarding-step-item">
            <span className="askem-onboarding-num">2</span>
            <span>Type your prompt and send</span>
          </div>
          <div className="askem-onboarding-step-item">
            <span className="askem-onboarding-num">3</span>
            <span>It auto-syncs to the other models</span>
          </div>
        </div>
        <div className="askem-onboarding-providers">
          {PROVIDERS.map((provider) => (
            <button
              key={provider}
              className="askem-onboarding-provider-btn"
              onClick={() => openProvider(provider)}
              type="button"
            >
              {provider}
              <span className="askem-onboarding-arrow">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LegalContent({ page, onBack }: { page: LegalPage; onBack: () => void }) {
  return (
    <section className="askem-legal-page">
      <div className="askem-legal-top">
        <button type="button" className="askem-legal-back" onClick={onBack}>
          ← Back
        </button>
      </div>
      {page === 'terms' ? (
        <div className="askem-legal-body">
          <h2>Terms of Service</h2>
          <p className="askem-legal-updated">Last updated: April 2026</p>

          <h3>1. Acceptance</h3>
          <p>By installing or using the ask&apos;em browser extension (&quot;Extension&quot;), you agree to these Terms of Service. If you do not agree, please uninstall the Extension.</p>

          <h3>2. Description of Service</h3>
          <p>ask&apos;em is a browser extension that synchronizes prompts you type across multiple AI chat provider websites. The Extension operates entirely within your browser and interacts with third-party websites on your behalf.</p>

          <h3>3. Third-Party Services</h3>
          <p>The Extension interacts with third-party AI chat services (Claude, ChatGPT, Gemini, DeepSeek). Your use of those services is governed by their respective terms. ask&apos;em is not affiliated with any of these providers.</p>

          <h3>4. User Responsibilities</h3>
          <p>You are responsible for your prompts and for complying with each provider&apos;s terms. You must have valid accounts with the providers you use.</p>

          <h3>5. No Warranty</h3>
          <p>The Extension is provided &quot;as is&quot; without warranty of any kind. AI provider websites may change at any time, which may temporarily affect functionality.</p>

          <h3>6. Limitation of Liability</h3>
          <p>To the maximum extent permitted by law, the developers of ask&apos;em shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Extension.</p>

          <h3>7. Changes</h3>
          <p>We may update these terms. Continued use after changes constitutes acceptance.</p>
        </div>
      ) : (
        <div className="askem-legal-body">
          <h2>Privacy Policy</h2>
          <p className="askem-legal-updated">Last updated: April 2026</p>

          <h3>1. Data Collection</h3>
          <p>ask&apos;em does <strong>not</strong> collect, transmit, or store any personal data on external servers. All data remains entirely within your browser&apos;s local storage.</p>

          <h3>2. What We Store Locally</h3>
          <p>The Extension stores the following data in your browser&apos;s chrome.storage:</p>
          <ul>
            <li>Workspace state (which chat sessions are grouped together)</li>
            <li>Your preference settings (default providers, sync toggle state)</li>
            <li>Debug logs (only when you explicitly enable diagnostic tracing)</li>
          </ul>
          <p>This data never leaves your browser.</p>

          <h3>3. Prompt Content</h3>
          <p>Your prompts are read temporarily in memory to forward them between chat tabs. They are <strong>not</strong> stored persistently, logged, or transmitted to any server controlled by us.</p>

          <h3>4. Third-Party Interaction</h3>
          <p>When you use the Extension, your prompts are sent to third-party AI providers through their official web interfaces — exactly as if you typed them yourself. Each provider&apos;s own privacy policy governs how they handle your data.</p>

          <h3>5. Analytics &amp; Tracking</h3>
          <p>ask&apos;em contains <strong>no analytics, telemetry, or tracking</strong> of any kind.</p>

          <h3>6. Permissions</h3>
          <p>The Extension requests only the minimum permissions needed:</p>
          <ul>
            <li><strong>storage</strong> — to save your preferences locally</li>
            <li><strong>tabs</strong> — to manage and sync across chat tabs</li>
          </ul>

          <h3>7. Contact</h3>
          <p>Questions about this policy? Reach us at one77r@gmail.com.</p>
        </div>
      )}
    </section>
  );
}
