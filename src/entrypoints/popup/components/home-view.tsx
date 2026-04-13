import type { Provider, WorkspaceSummary } from '../../../runtime/protocol';
import { OnboardingCard } from './onboarding-card';
import { WarningCard } from './warning-card';
import { WorkspaceCard } from './workspace-card';

const MIN_WORKSPACES_FOR_FREEZE_CONTROL = 2;

export function HomeView(props: {
  atLimit: boolean;
  workspaceCount: number;
  workspaces: WorkspaceSummary[];
  onboardingProviders: Provider[];
  globalSyncEnabled: boolean;
  loading: boolean;
  busyKey: string | null;
  onClearWorkspace: (workspaceId: string) => Promise<void>;
  onClearProvider: (workspaceId: string, provider: Provider) => Promise<void>;
  onToggleGlobalSync: () => void;
}) {
  return (
    <>
      {props.atLimit ? (
        <WarningCard
          eyebrow="Heads up"
          title="All set slots are in use."
          body="Clear a finished set below to free up a slot for your next comparison."
        />
      ) : null}

      <section className="askem-section-heading">
        <div>
          <h2>Running Sets</h2>
        </div>
        <span className="askem-section-meta">{props.workspaceCount}</span>
      </section>

      <section className="askem-workspaces">
        {props.workspaces.length ? (
          props.workspaces.map((workspaceSummary) => (
            <WorkspaceCard
              key={workspaceSummary.workspace.id}
              workspaceSummary={workspaceSummary}
              globalSyncEnabled={props.globalSyncEnabled}
              busyKey={props.busyKey}
              onClearWorkspace={props.onClearWorkspace}
              onClearProvider={props.onClearProvider}
            />
          ))
        ) : (
          <OnboardingCard providers={props.onboardingProviders} />
        )}
      </section>

      {props.workspaceCount >= MIN_WORKSPACES_FOR_FREEZE_CONTROL && (
        <section className="askem-freeze-section">
          <div className="askem-freeze-copy">
            <span className="askem-freeze-title">Freeze the world</span>
            <span className="askem-freeze-sub">Stop syncing for all sets</span>
          </div>
          <button
            type="button"
            className="askem-freeze-switch"
            data-enabled={String(!props.globalSyncEnabled)}
            onClick={props.onToggleGlobalSync}
            disabled={props.loading}
            aria-label={props.globalSyncEnabled ? 'Freeze sync' : 'Unfreeze sync'}
          />
        </section>
      )}
    </>
  );
}
