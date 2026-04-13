import type { GroupMemberState, Provider, WorkspaceSummary } from '../../../runtime/protocol';
import { getVisibleWorkspaceProviders } from '../../../runtime/workspace';
import { SUPPORTED_SITES } from '../../../adapters/sites';
import { getWorkspaceProviderPresentation } from '../../../utils/workspace-provider-display';

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
}

function getProviderOrigin(provider: Provider): string {
  const site = SUPPORTED_SITES.find((s) => s.name === provider);
  return site?.origin ?? '#';
}

export function WorkspaceCard({
  workspaceSummary,
  globalSyncEnabled,
  busyKey,
  onClearWorkspace,
  onClearProvider,
}: {
  workspaceSummary: WorkspaceSummary;
  globalSyncEnabled: boolean;
  busyKey: string | null;
  onClearWorkspace: (workspaceId: string) => Promise<void>;
  onClearProvider: (workspaceId: string, provider: Provider) => Promise<void>;
}) {
  const { workspace, memberStates } = workspaceSummary;
  const visibleProviders = getVisibleWorkspaceProviders(workspace);
  const allProvidersInactive =
    visibleProviders.length > 0 &&
    visibleProviders.every((provider) => (memberStates[provider] ?? 'inactive') === 'inactive');

  const displayLabel = workspace.label
    ? workspace.label.length > 50
      ? workspace.label.slice(0, 50) + '…'
      : workspace.label
    : `Set #${workspace.id.slice(0, 8)}`;

  return (
    <article className="askem-card askem-set-card">
      <div className="askem-card-top">
        <div>
          <h2 className="askem-set-label" title={workspace.label ?? undefined}>
            {displayLabel}
          </h2>
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
          const issue = workspace.memberIssues?.[provider] ?? null;
          const presentation = getWorkspaceProviderPresentation({
            memberState: rawState,
            memberIssue: issue,
            enabled,
            globalSyncEnabled,
            hasMember: rawState !== 'inactive',
          });
          const showOpenLink = rawState === 'inactive' && !member?.sessionId && !issue;

          return (
            <div className="askem-provider-row" key={`${workspace.id}:${provider}`}>
              <div className="askem-provider-main">
                <span className="askem-provider-name">{provider}</span>
                <div className="askem-provider-statusline">
                  <span className={`askem-state askem-state-${presentation.tone}`}>
                    {presentation.label}
                  </span>
                  {showOpenLink ? (
                    <a
                      className="askem-provider-open-link"
                      href={getProviderOrigin(provider)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        event.preventDefault();
                        void chrome.tabs.create({ url: getProviderOrigin(provider) });
                      }}
                    >
                      Open {provider}
                    </a>
                  ) : (
                    <span className="askem-provider-subcopy">{presentation.detail}</span>
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
