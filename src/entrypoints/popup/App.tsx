import { startTransition, useEffect, useState } from 'react';
import type { DebugLogEntry, Provider, StatusResponseMessage, WorkspaceSummary } from '../../runtime/protocol';

const PROVIDERS: Provider[] = ['claude', 'chatgpt', 'gemini', 'deepseek'];

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
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
  const limit = status?.workspaceLimit ?? 3;
  const atLimit = workspaceCount >= limit;
  const availableSlots = Math.max(0, limit - workspaceCount);

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
          <div>
            <p className="askem-eyebrow">Parallel Prompt Control</p>
            <h1>ask&apos;em</h1>
          </div>
          <button className="askem-refresh" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Syncing' : 'Refresh'}
          </button>
        </header>

        <section className="askem-summary">
          <div>
            <span className="askem-summary-label">Groups</span>
            <strong>{workspaceCount}</strong>
          </div>
          <div>
            <span className="askem-summary-label">Limit</span>
            <strong>{limit}</strong>
          </div>
          <div>
            <span className="askem-summary-label">Global Sync</span>
            <strong>{status?.globalSyncEnabled ? 'On' : 'Off'}</strong>
          </div>
        </section>

        {atLimit ? (
          <WarningCard
            eyebrow="Warning"
            title="You reached your group limit."
            body="New sends from a fresh chat will not create another group until you clear one below."
          />
        ) : (
          <section className="askem-notice">
            {availableSlots} slot{availableSlots === 1 ? '' : 's'} left. Bound chats can continue syncing
            from any provider tab in the same group.
          </section>
        )}

        <section className="askem-card askem-defaults-card">
          <div className="askem-card-top">
            <div>
              <p className="askem-card-label">Default Targets</p>
              <h2>New Group Fan-out</h2>
            </div>
          </div>
          <p className="askem-card-copy">
            Choose which providers should join when a group is first created. The source provider
            is always kept in.
          </p>
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
                  <span>{provider}</span>
                  <span>{active ? 'on' : 'off'}</span>
                </button>
              );
            })}
          </div>
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
              <p>No active groups.</p>
              <span>Create one by sending the first prompt from a new-chat page.</span>
            </div>
          )}
        </section>

        <section className="askem-card askem-logs-card">
          <div className="askem-card-top">
            <div>
              <p className="askem-card-label">Debug Mode</p>
              <h2>Trace Capture</h2>
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
          <p className="askem-card-copy">
            Logging is off by default. Turn it on only when you need a bug report trail, then export
            the JSON file and send it over.
          </p>
          <div className="askem-logs-list">
            {status?.debugLoggingEnabled ? (
              status?.recentLogs.length ? (
                status.recentLogs.map((log) => <LogRow key={log.id} log={log} />)
              ) : (
                <p className="askem-logs-empty">Logging is enabled, but no events have been captured yet.</p>
              )
            ) : (
              <p className="askem-logs-empty">Logging is currently off.</p>
            )}
          </div>
        </section>

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
  const { workspace, memberStatuses } = workspaceSummary;

  return (
    <article className="askem-card">
      <div className="askem-card-top">
        <div>
          <p className="askem-card-label">Group</p>
          <h2>#{workspace.id.slice(0, 8)}</h2>
        </div>
        <button
          className="askem-clear-workspace"
          onClick={() => void onClearWorkspace(workspace.id)}
          disabled={busyKey === workspace.id}
        >
          Clear Group
        </button>
      </div>

      <div className="askem-card-meta">
        <span>Created {formatTime(workspace.createdAt)}</span>
        <span>Updated {formatTime(workspace.updatedAt)}</span>
      </div>

      <div className="askem-provider-grid">
        {PROVIDERS.map((provider) => {
          const member = workspace.members[provider];
          const state = memberStatuses[provider] ?? 'missing';

          return (
            <div className="askem-provider-row" key={`${workspace.id}:${provider}`}>
              <div>
                <span className="askem-provider-name">{provider}</span>
                <span className={`askem-state askem-state-${state}`}>{state}</span>
              </div>
              <div className="askem-provider-actions">
                <code>{member?.sessionId ? member.sessionId.slice(0, 8) : 'unbound'}</code>
                <button
                  className="askem-provider-clear"
                  onClick={() => void onClearProvider(workspace.id, provider)}
                  disabled={!member || busyKey === `${workspace.id}:${provider}`}
                >
                  Clear
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
