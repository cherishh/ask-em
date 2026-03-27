import { startTransition, useEffect, useState } from 'react';
import type { Provider, StatusResponseMessage, WorkspaceSummary } from '../../runtime/protocol';

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

export default function App() {
  const [status, setStatus] = useState<StatusResponseMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const nextStatus = await requestStatus();
    startTransition(() => {
      setStatus(nextStatus);
      setLoading(false);
    });
  };

  useEffect(() => {
    void refresh();
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
            <span className="askem-summary-label">Workspaces</span>
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

        <section className={`askem-notice ${atLimit ? 'is-warning' : ''}`}>
          {atLimit
            ? 'Workspace limit reached. Clear an old mirror set before creating a new one.'
            : 'Bound sessions can continue syncing from any provider tab in the workspace.'}
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
              <p>No active workspaces.</p>
              <span>Create one by sending the first prompt from a new-chat page.</span>
            </div>
          )}
        </section>
      </section>
    </main>
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
          <p className="askem-card-label">Workspace</p>
          <h2>{workspace.id.slice(0, 8)}</h2>
        </div>
        <button
          className="askem-clear-workspace"
          onClick={() => void onClearWorkspace(workspace.id)}
          disabled={busyKey === workspace.id}
        >
          Clear All
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
