import { startTransition, useEffect, useState } from 'react';
import { DidYouKnowCard } from './components/DidYouKnowCard';
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

function getDisplayMemberStateLabel(state: GroupMemberState): string {
  const displayState = getDisplayMemberState(state);

  if (displayState === 'inactive') {
    return 'No Live Tab';
  }

  if (displayState === 'pending') {
    return 'Connecting';
  }

  return 'Active';
}

function getMemberOutcomeCopy(state: GroupMemberState): string {
  const displayState = getDisplayMemberState(state);

  if (displayState === 'inactive') {
    return 'Will reopen on the next synced prompt';
  }

  if (displayState === 'pending') {
    return 'Waiting for this model to attach';
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

export default function App() {
  const [activeView, setActiveView] = useState<PopupView>('home');
  const [status, setStatus] = useState<StatusResponseMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<Provider[]>(PROVIDERS);
  const [logActionBusy, setLogActionBusy] = useState(false);

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

  return (
    <main className="askem-popup-shell">
      <div className="askem-popup-backdrop" />
      <section className="askem-panel">
        <header className="askem-hero">
          <div className="askem-brand-block">
            <h1>ask&apos;em</h1>
            <p className="askem-slogan">Send one prompt across official model chats.</p>
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
                body="New sends from a fresh chat will not create another set until you clear one below."
              />
            ) : null}

            <section className="askem-section-heading">
              <div>
                <p className="askem-card-label">Live Overview</p>
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
                  <span>Open a fresh chat on Claude, ChatGPT, Gemini, or DeepSeek.</span>
                  <strong>Send your first prompt and ask&apos;em will start a set automatically.</strong>
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            <section className="askem-card askem-settings-section">
              <div className="askem-defaults-heading">
                <div className="askem-defaults-copy">
                  <p className="askem-card-label">Auto-include Models</p>
                  <p className="askem-defaults-title">Used when a brand-new set starts.</p>
                </div>
                <span className="askem-defaults-meta">{selectedProviders.length} selected</span>
              </div>
              <p className="askem-defaults-note">The source tab always stays included.</p>
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
            </section>

            <DidYouKnowCard />

            <section className="askem-card askem-logs-card">
              <div className="askem-debug-top">
                <div className="askem-debug-copy">
                  <p className="askem-card-label">Debug Mode</p>
                  <h2>Trace Capture</h2>
                  <p className="askem-card-copy">
                    Keep this off unless you need a bug report trail.
                  </p>
                </div>
                <div className="askem-log-actions">
                  <button
                    className={`askem-provider-chip askem-log-toggle ${status?.debugLoggingEnabled ? 'is-active' : ''}`}
                    onClick={() => void toggleDebugLogging()}
                    disabled={logActionBusy}
                  >
                    <span>Logging</span>
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
                        Logging is enabled, but no events have been captured yet.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="askem-settings-note">
                  Turn it on only when something breaks, then export the JSON file and send it over.
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
          <p className="askem-card-label">Set</p>
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
          No live tabs are attached. This set will be auto-cleared soon.
        </p>
      ) : null}

      <div className="askem-provider-grid">
        {visibleProviders.map((provider) => {
          const member = workspace.members[provider];
          const state = getDisplayMemberState(memberStates[provider] ?? 'inactive');
          const stateLabel = getDisplayMemberStateLabel(memberStates[provider] ?? 'inactive');
          const outcomeCopy = getMemberOutcomeCopy(memberStates[provider] ?? 'inactive');
          const sessionLabel = member?.sessionId ? member.sessionId.slice(0, 8) : 'waiting';

          return (
            <div className="askem-provider-row" key={`${workspace.id}:${provider}`}>
              <div className="askem-provider-main">
                <span className="askem-provider-name">{provider}</span>
                <div className="askem-provider-statusline">
                  <span className={`askem-state askem-state-${state}`}>{stateLabel}</span>
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
