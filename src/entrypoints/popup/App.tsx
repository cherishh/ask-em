import { startTransition, useEffect, useState } from 'react';
import { ALL_PROVIDERS as PROVIDERS } from '../../runtime/protocol';
import type {
  DebugLogEntry,
  GroupMemberState,
  Provider,
  StatusResponseMessage,
  WorkspaceSummary,
} from '../../runtime/protocol';
import { getVisibleWorkspaceProviders } from '../../runtime/workspace';

type PopupView = 'home' | 'settings';

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
  if (!enabled) {
    return 'sync-paused';
  }

  return getDisplayMemberState(state);
}

function getDisplayMemberStateLabel(state: GroupMemberState, enabled: boolean): string {
  if (!enabled) {
    return 'Sync Paused';
  }

  const displayState = getDisplayMemberState(state);

  if (displayState === 'inactive') {
    return 'No Live Tab';
  }

  if (displayState === 'pending') {
    return 'Connecting';
  }

  return 'Active';
}

function getMemberOutcomeCopy(state: GroupMemberState, enabled: boolean): string {
  if (!enabled) {
    return 'Next prompt will stay out of sync';
  }

  const displayState = getDisplayMemberState(state);

  if (displayState === 'inactive') {
    return 'Reopens on the next synced prompt';
  }

  if (displayState === 'pending') {
    return 'Waiting for this model to connect';
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

  const refresh = async () => {
    setLoading(true);
    const nextStatus = await requestStatus();
    startTransition(() => {
      setStatus(nextStatus);
      if (nextStatus) {
        setSelectedProviders(
          PROVIDERS.filter((provider) => nextStatus.defaultEnabledProviders[provider]),
        );
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
            <p className="askem-slogan">Send one prompt to official model chats at once.</p>
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
            className={`askem-view-tab ${activeView === 'settings' ? 'is-active' : ''}`}
            onClick={() => setActiveView('settings')}
            type="button"
          >
            Advanced
          </button>
        </nav>

        {activeView === 'home' ? (
          <>
            {atLimit ? (
              <WarningCard
                eyebrow="Warning"
                title="You reached your set limit."
                body="Start another set after you clear one below."
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
                <div className="askem-empty">
                  <p>No running sets yet.</p>
                  <span>
                    Open a fresh chat on Claude, ChatGPT, Gemini, or DeepSeek, then send your
                    first prompt to start a set automatically.
                  </span>
                </div>
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
          </>
        )}

        <footer className="askem-footer">
          <span>by </span>
          <a href="https://tuxi.dev/" target="_blank" rel="noreferrer">
            Tuxi
          </a>
          <span> · one77r@gmail.com</span>
        </footer>
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

  return (
    <article className="askem-card askem-set-card">
      <div className="askem-card-top">
        <div>
          <h2>Set #{workspace.id.slice(0, 8)}</h2>
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
          const stateTone = getDisplayMemberStateTone(memberStates[provider] ?? 'inactive', enabled);
          const stateLabel = getDisplayMemberStateLabel(memberStates[provider] ?? 'inactive', enabled);
          const outcomeCopy = getMemberOutcomeCopy(memberStates[provider] ?? 'inactive', enabled);
          const sessionLabel = member?.sessionId ? member.sessionId.slice(0, 8) : 'not connected';

          return (
            <div className="askem-provider-row" key={`${workspace.id}:${provider}`}>
              <div className="askem-provider-main">
                <span className="askem-provider-name">{provider}</span>
                <div className="askem-provider-statusline">
                  <span className={`askem-state askem-state-${stateTone}`}>{stateLabel}</span>
                  <span className="askem-provider-subcopy">{outcomeCopy}</span>
                </div>
              </div>
              <div className="askem-provider-actions">
                <code>{sessionLabel}</code>
                <button
                  className="askem-provider-clear"
                  onClick={() => void onClearProvider(workspace.id, provider)}
                  disabled={busyKey === `${workspace.id}:${provider}`}
                >
                  Remove from Set
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
