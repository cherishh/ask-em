import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ALL_PROVIDERS as PROVIDERS,
  DEFAULT_SHORTCUTS,
  MAX_WORKSPACES,
  formatShortcutDisplay,
  resolveShortcutConfig,
} from '../../runtime/protocol';
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
import { getWorkspaceProviderDisplay } from '../../utils/workspace-provider-display';
import { RequestProvidersModal } from './components/request-providers-modal';
import { useFeedback } from './hooks/use-feedback';
import { useDiagnostics } from './hooks/use-diagnostics';
import { usePopupStatus } from './hooks/use-popup-status';
import { useProviderRequest } from './hooks/use-provider-request';

type PopupView = 'home' | 'settings' | 'legal';
type LegalPage = 'terms' | 'privacy';

const MIN_WORKSPACES_FOR_FREEZE_CONTROL = 2;
const DEV_CONTROL_STORAGE_KEY = 'askem-dev-control';

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
}

function getDisplayMemberStateTone(
  state: GroupMemberState,
  issue: WorkspaceSummary['memberIssues'][Provider],
  enabled: boolean,
  globalSyncEnabled: boolean,
): 'active' | 'inactive' | 'pending' | 'sync-paused' | 'frozen' | 'warning' {
  const display = getWorkspaceProviderDisplay({
    memberState: state,
    memberIssue: issue ?? null,
    enabled,
    globalSyncEnabled,
    hasMember: state !== 'inactive',
  });

  switch (display.kind) {
    case 'ready':
      return 'active';
    case 'connecting':
      return 'pending';
    case 'paused':
      return globalSyncEnabled ? 'sync-paused' : 'frozen';
    case 'needs-login':
    case 'loading':
    case 'needs-attention':
      return 'warning';
    case 'will-reopen':
      return 'inactive';
  }
}

function getDisplayMemberStateLabel(
  state: GroupMemberState,
  issue: WorkspaceSummary['memberIssues'][Provider],
  enabled: boolean,
  globalSyncEnabled: boolean,
): string {
  return getWorkspaceProviderDisplay({
    memberState: state,
    memberIssue: issue ?? null,
    enabled,
    globalSyncEnabled,
    hasMember: state !== 'inactive',
  }).label;
}

function getMemberOutcomeCopy(
  state: GroupMemberState,
  issue: WorkspaceSummary['memberIssues'][Provider],
  enabled: boolean,
  globalSyncEnabled: boolean,
): string {
  return getWorkspaceProviderDisplay({
    memberState: state,
    memberIssue: issue ?? null,
    enabled,
    globalSyncEnabled,
    hasMember: state !== 'inactive',
  }).detail;
}

export default function App() {
  const [activeView, setActiveView] = useState<PopupView>('home');
  const [activeLegalPage, setActiveLegalPage] = useState<LegalPage>('terms');
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [devModalOpen, setDevModalOpen] = useState(false);
  const [devActionBusy, setDevActionBusy] = useState(false);
  const [recordingShortcutId, setRecordingShortcutId] = useState<ShortcutId | null>(null);
  const {
    status,
    loading,
    busyKey,
    selectedProviders,
    resolvedShortcuts,
    refresh,
    clearWorkspace,
    clearProvider,
    toggleDefaultProvider,
    toggleAutoSyncNewChats,
    toggleGlobalSync,
    toggleCloseTabsOnDeleteSet,
    updateShortcut,
    resetShortcuts,
    resetIndicatorPositions,
    clearPersistentStorage,
  } = usePopupStatus();
  const {
    logActionBusy,
    clearLogs,
    toggleDebugLogging,
    downloadLogs,
  } = useDiagnostics(status?.debugLoggingEnabled, refresh);
  const {
    requestModalOpen,
    requestedProviders,
    requestSubmitting,
    requestSubmitted,
    requestComingSoon,
    requestCooldownUntil,
    toggleRequestedProvider,
    openRequestModal,
    closeRequestModal,
    submitRequestModal,
    resetRequestCooldownForDev,
  } = useProviderRequest();
  const {
    feedbackText,
    includeLogs,
    feedbackSubmitting,
    feedbackSubmitted,
    feedbackError,
    setFeedbackText,
    setIncludeLogs,
    resetFeedback,
    submitFeedback,
  } = useFeedback();
  const onboardingProviders = useMemo(
    () => selectedProviders,
    [selectedProviders],
  );

  const workspaceCount = status?.workspaces.length ?? 0;
  const limit = status?.workspaceLimit ?? MAX_WORKSPACES;
  const atLimit = workspaceCount >= limit;
  const globalSyncEnabled = status?.globalSyncEnabled ?? true;
  const autoSyncNewChatsEnabled = status?.autoSyncNewChatsEnabled ?? true;
  const persistedDevControl = window.localStorage.getItem(DEV_CONTROL_STORAGE_KEY) === 'true';

  if (window.dev_control === true && !persistedDevControl) {
    window.localStorage.setItem(DEV_CONTROL_STORAGE_KEY, 'true');
  }

  if (window.dev_control === false && persistedDevControl) {
    window.localStorage.removeItem(DEV_CONTROL_STORAGE_KEY);
  }

  const showDevControl =
    window.dev_control === true ||
    window.localStorage.getItem(DEV_CONTROL_STORAGE_KEY) === 'true';

  const handleClearPersistentStorage = useCallback(async () => {
    setDevActionBusy(true);

    try {
      window.localStorage.clear();
      await clearPersistentStorage();
      setDevModalOpen(false);
    } finally {
      setDevActionBusy(false);
    }
  }, [clearPersistentStorage]);

  return (
    <main className="askem-popup-shell">
      <div className="askem-popup-backdrop" />
      <section className="askem-panel">
        <header className="askem-hero">
          <div className="askem-brand-block">
            <h1>ask&apos;em</h1>
            <p className="askem-slogan">One prompt, every official AI chat — full features, zero compromise.</p>
          </div>
          {/* <button className="askem-refresh askem-refresh-subtle askem-refresh-corner" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Syncing' : 'Refresh'}
          </button> */}
          <div className="askem-hero-actions">
            {showDevControl ? (
              <button className="askem-refresh askem-refresh-subtle askem-refresh-corner" onClick={() => setDevModalOpen(true)} type="button">
                Dev
              </button>
            ) : null}
            <button
              className="askem-refresh askem-refresh-subtle askem-refresh-corner"
              onClick={() => {
                resetFeedback();
                setFeedbackModalOpen(true);
              }}
              type="button"
            >
              Feedback
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
                title="All set slots are in use."
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
                    globalSyncEnabled={globalSyncEnabled}
                    busyKey={busyKey}
                    onClearWorkspace={clearWorkspace}
                    onClearProvider={clearProvider}
                  />
                ))
              ) : (
                <OnboardingCard providers={onboardingProviders} />
              )}
            </section>

            {workspaceCount >= MIN_WORKSPACES_FOR_FREEZE_CONTROL && (
              <section className="askem-freeze-section">
                <div className="askem-freeze-copy">
                  <span className="askem-freeze-title">Freeze the world</span>
                  <span className="askem-freeze-sub">Stop syncing for all sets</span>
                </div>
                <button
                  type="button"
                  className="askem-freeze-switch"
                  data-enabled={String(!globalSyncEnabled)}
                  onClick={() => void toggleGlobalSync()}
                  disabled={loading}
                  aria-label={globalSyncEnabled ? 'Freeze sync' : 'Unfreeze sync'}
                />
              </section>
            )}
          </>
        ) : (
          <>
            <section className="askem-advanced-heading">
              <div>
                <h2>Advanced Tools</h2>
              </div>
            </section>

            <section className="askem-card askem-unified-settings">
              <p className="askem-card-label">Settings</p>

              <div className="askem-us-group">
                <div className="askem-us-row-header">
                  <span className="askem-us-row-title">Default models</span>
                  <button className="askem-request-link" onClick={openRequestModal} type="button">
                    + more
                  </button>
                </div>
                <div className="askem-dm-list">
                  {PROVIDERS.map((provider) => {
                    const active = selectedProviders.includes(provider);
                    return (
                      <button
                        key={provider}
                        className={`askem-dm-item ${active ? 'is-active' : ''}`}
                        onClick={() => void toggleDefaultProvider(provider)}
                        disabled={loading}
                        type="button"
                      >
                        <span className="askem-dm-name">{provider}</span>
                        <span className="askem-dm-check" aria-hidden="true">{active ? '✓' : ''}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="askem-us-divider" />

              <div className="askem-us-group">
                <div className="askem-us-toggle-row">
                  <div>
                    <span className="askem-us-row-title">Default auto-sync new chats</span>
                    <span className="askem-us-row-sub">
                      {autoSyncNewChatsEnabled
                        ? 'New chats automatically fan-out.'
                        : 'New chats stay solo.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="askem-us-switch"
                    data-enabled={String(autoSyncNewChatsEnabled)}
                    onClick={() => void toggleAutoSyncNewChats()}
                    disabled={loading}
                    aria-label={autoSyncNewChatsEnabled ? 'Disable auto-sync for new chats' : 'Enable auto-sync for new chats'}
                  />
                </div>
              </div>

              <div className="askem-us-divider" />

              <div className="askem-us-group">
                <div className="askem-us-toggle-row">
                  <div>
                    <span className="askem-us-row-title">Close tabs used by this set</span>
                    <span className="askem-us-row-sub">
                      {status?.closeTabsOnDeleteSet
                        ? 'Delete Set also closes tabs currently used by this set.'
                        : 'Delete Set keeps those tabs open.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="askem-us-switch"
                    data-enabled={String(Boolean(status?.closeTabsOnDeleteSet))}
                    onClick={() => void toggleCloseTabsOnDeleteSet()}
                    disabled={loading}
                    aria-label={
                      status?.closeTabsOnDeleteSet
                        ? 'Disable closing provider tabs when deleting a set'
                        : 'Enable closing provider tabs when deleting a set'
                    }
                  />
                </div>
              </div>

              <div className="askem-us-divider" />

              <div className="askem-us-group">
                <div className="askem-us-row-header">
                  <div>
                    <span className="askem-us-row-title">Indicator position</span>
                    <span className="askem-us-row-sub">Reset the floating page indicator back to its default spot.</span>
                  </div>
                  <button
                    type="button"
                    className="askem-us-reset"
                    onClick={() => void resetIndicatorPositions()}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="askem-us-divider" />

              <div className="askem-us-group">
                <div className="askem-us-row-header">
                  <span className="askem-us-row-title">Shortcut</span>
                  {JSON.stringify(resolvedShortcuts) !== JSON.stringify(DEFAULT_SHORTCUTS) && (
                    <button
                      type="button"
                      className="askem-us-reset"
                      onClick={() => void resetShortcuts()}
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
                        binding={resolvedShortcuts[id]}
                        recording={recordingShortcutId === id}
                        onRecordingChange={(recording) => setRecordingShortcutId(recording ? id : null)}
                        onRecord={(binding) => void updateShortcut(id, binding)}
                        conflict={false}
                      />
                    </div>
                  ))}
                </div>
              </div>
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
                      {/* <button className="askem-provider-clear" onClick={() => void copyLogs()} disabled={logActionBusy}>
                        Copy Logs
                      </button> */}
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
              <div className="askem-legal-links">
                <button type="button" className="askem-legal-link" onClick={() => { setActiveLegalPage('terms'); setActiveView('legal'); }}>
                  Terms of Service
                </button>
                <span className="askem-legal-sep">·</span>
                <button type="button" className="askem-legal-link" onClick={() => { setActiveLegalPage('privacy'); setActiveView('legal'); }}>
                  Privacy Policy
                </button>
              </div>
              <div className="askem-author">
                <span>by </span>
                <a href="https://tuxi.dev/" target="_blank" rel="noreferrer">Tuxi</a>
                <span> · one77r@gmail.com</span>
              </div>
            </footer>
          </>
        )}
      </section>

      <RequestProvidersModal
        open={requestModalOpen}
        requestedProviders={requestedProviders}
        requestSubmitting={requestSubmitting}
        requestSubmitted={requestSubmitted}
        requestComingSoon={requestComingSoon}
        requestCooldownUntil={requestCooldownUntil}
        onToggleProvider={toggleRequestedProvider}
        onClose={closeRequestModal}
        onSubmit={() => void submitRequestModal()}
      />

      {feedbackModalOpen ? (
        <div className="askem-modal-overlay" onClick={() => !feedbackSubmitting && setFeedbackModalOpen(false)} role="presentation">
          <section
            className="askem-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="askem-modal-top">
              <div>
                <p className="askem-card-label">Feedback</p>
                <h2>Send Feedback</h2>
              </div>
              <button className="askem-modal-close" onClick={() => setFeedbackModalOpen(false)} type="button" disabled={feedbackSubmitting}>
                Close
              </button>
            </div>
            {feedbackSubmitted ? (
              <div className="askem-modal-state">
                <p>Thanks. Your feedback is in.</p>
                <span>We&apos;ll review it together with the attached context.</span>
              </div>
            ) : (
              <>
                <div className="askem-feedback-field">
                  <label className="askem-feedback-label" htmlFor="askem-feedback-input">
                    Feedback
                  </label>
                  <textarea
                    id="askem-feedback-input"
                    className="askem-feedback-textarea"
                    placeholder="What happened? What felt wrong? What should change?"
                    value={feedbackText}
                    onChange={(event) => setFeedbackText(event.target.value)}
                    rows={6}
                    disabled={feedbackSubmitting}
                  />
                </div>
                <label className="askem-feedback-checkbox">
                  <input
                    type="checkbox"
                    checked={includeLogs}
                    onChange={(event) => setIncludeLogs(event.target.checked)}
                    disabled={feedbackSubmitting}
                  />
                  <span>Include logs</span>
                </label>
                {feedbackError ? (
                  <p className="askem-feedback-error">{feedbackError}</p>
                ) : (
                  <p className="askem-feedback-note">
                    {includeLogs
                      ? 'Current debug logs snapshot will be attached to this report.'
                      : 'Only your written feedback will be sent.'}
                  </p>
                )}
                <div className="askem-modal-actions">
                  <button className="askem-provider-clear" onClick={() => setFeedbackModalOpen(false)} type="button" disabled={feedbackSubmitting}>
                    Cancel
                  </button>
                  <button
                    className="askem-clear-workspace"
                    onClick={() => void submitFeedback()}
                    disabled={feedbackSubmitting || feedbackText.trim().length === 0}
                    type="button"
                  >
                    {feedbackSubmitting ? 'Sending' : 'Send Feedback'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}

      {devModalOpen ? (
        <div className="askem-modal-overlay" onClick={() => !devActionBusy && setDevModalOpen(false)} role="presentation">
          <section
            className="askem-modal askem-dev-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="askem-modal-top">
              <div>
                <p className="askem-card-label">Development</p>
                <h2>Dev Tools</h2>
              </div>
              <button className="askem-modal-close" onClick={() => setDevModalOpen(false)} type="button" disabled={devActionBusy}>
                Close
              </button>
            </div>
            <div className="askem-dev-list">
              <div className="askem-dev-row">
                <div className="askem-dev-copy">
                  <p className="askem-dev-title">Clear persistent storage</p>
                  <span className="askem-dev-desc">Reset popup settings, workspace state, logs, and saved indicator positions.</span>
                </div>
                <button
                  className="askem-provider-clear"
                  onClick={() => void handleClearPersistentStorage()}
                  disabled={devActionBusy}
                  type="button"
                >
                  {devActionBusy ? 'Clearing' : 'Run'}
                </button>
              </div>
              <div className="askem-dev-row">
                <div className="askem-dev-copy">
                  <p className="askem-dev-title">Reset request cooldown</p>
                  <span className="askem-dev-desc">Clear the local cooldown for Request more providers.</span>
                </div>
                <button
                  className="askem-provider-clear"
                  onClick={() => resetRequestCooldownForDev()}
                  disabled={devActionBusy}
                  type="button"
                >
                  Run
                </button>
              </div>
            </div>
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
    visibleProviders.every(
      (provider) => (memberStates[provider] ?? 'inactive') === 'inactive',
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
          const issue = workspace.memberIssues?.[provider] ?? null;
          const stateTone = getDisplayMemberStateTone(rawState, issue, enabled, globalSyncEnabled);
          const stateLabel = getDisplayMemberStateLabel(rawState, issue, enabled, globalSyncEnabled);
          const outcomeCopy = getMemberOutcomeCopy(rawState, issue, enabled, globalSyncEnabled);
          const showOpenLink = rawState === 'inactive' && !member?.sessionId && !issue;

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
    label: 'Single tab sync on/off',
  },
  {
    id: 'previousProviderTab',
    label: 'Go to previous tab',
  },
  {
    id: 'nextProviderTab',
    label: 'Go to next tab',
  },
] as const satisfies Array<{ id: ShortcutId; label: string }>;

function normalizeShortcutKey(event: KeyboardEvent): string {
  if (event.code === 'Period') {
    return '.';
  }

  if (event.code === 'Comma') {
    return ',';
  }

  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

function ShortcutRecorder({
  binding,
  recording,
  onRecordingChange,
  onRecord,
  conflict,
}: {
  binding: ShortcutBinding;
  recording: boolean;
  onRecordingChange: (recording: boolean) => void;
  onRecord: (binding: ShortcutBinding) => void;
  conflict: boolean;
}) {
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
        key: normalizeShortcutKey(event),
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
      };

      onRecord(newBinding);
      onRecordingChange(false);
    },
    [recording, onRecord, onRecordingChange],
  );

  useEffect(() => {
    if (!recording) return;
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, handleKeyDown]);

  useEffect(() => {
    if (!recording) return;
    const handleBlur = () => onRecordingChange(false);
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [recording, onRecordingChange]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`askem-shortcut-keys askem-shortcut-recorder ${recording ? 'is-recording' : ''} ${conflict ? 'is-conflict' : ''}`}
      onClick={() => onRecordingChange(!recording)}
    >
      {recording ? 'Press keys…' : formatShortcutDisplay(binding, isApple)}
    </button>
  );
}

function OnboardingCard({ providers }: { providers: Provider[] }) {
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
          ask&apos;em lets you compare models without leaving their official apps, so you keep artifacts, web search, file uploads, long-term memory, and every new feature each provider ships.
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
        <p className="askem-onboarding-hint">Make sure you&apos;re logged in to each provider you want to sync.</p>
        <div className="askem-onboarding-providers">
          {providers.length > 0 ? (
            providers.map((provider) => (
              <button
                key={provider}
                className="askem-onboarding-provider-btn"
                onClick={() => openProvider(provider)}
                type="button"
              >
                {provider}
                <span className="askem-onboarding-arrow">→</span>
              </button>
            ))
          ) : (
            <span className="askem-onboarding-empty">Enable a default model in Advanced.</span>
          )}
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
          <p>The Extension interacts with third-party AI chat services (Claude, ChatGPT, Gemini, DeepSeek, Manus). Your use of those services is governed by their respective terms. ask&apos;em is not affiliated with any of these providers.</p>

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
