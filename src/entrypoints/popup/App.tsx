import { useCallback, useMemo, useState } from 'react';
import {
  MAX_WORKSPACES,
} from '../../runtime/protocol';
import { LegalContent, type LegalPage } from './components/legal-content';
import { HomeView } from './components/home-view';
import { AdvancedView } from './components/advanced-view';
import { RequestProvidersModal } from './components/request-providers-modal';
import { FeedbackModal } from './components/feedback-modal';
import { DevToolsModal } from './components/dev-tools-modal';
import { useDevControl } from './hooks/use-dev-control';
import { useFeedback } from './hooks/use-feedback';
import { useDiagnostics } from './hooks/use-diagnostics';
import { usePopupStatus } from './hooks/use-popup-status';
import { useProviderRequest } from './hooks/use-provider-request';

type PopupView = 'home' | 'settings' | 'legal';

export default function App() {
  const popupVersion = chrome.runtime.getManifest().version;
  const [activeView, setActiveView] = useState<PopupView>('home');
  const [activeLegalPage, setActiveLegalPage] = useState<LegalPage>('terms');
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [devModalOpen, setDevModalOpen] = useState(false);
  const [devActionBusy, setDevActionBusy] = useState(false);
  const [recordingShortcutId, setRecordingShortcutId] = useState<
    'togglePageParticipation' | 'previousProviderTab' | 'nextProviderTab' | null
  >(null);
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
    requestEndpointNotConfigured,
    requestCooldownUntil,
    toggleRequestedProvider,
    openRequestModal,
    closeRequestModal,
    submitRequestModal,
    resetRequestCooldownForDev,
  } = useProviderRequest();
  const {
    feedbackConfigured,
    feedbackStep,
    feedbackKind,
    featureRequestChoice,
    customFeatureRequestText,
    feedbackText,
    includeLogs,
    feedbackSubmitting,
    feedbackSubmitted,
    feedbackError,
    canSubmit,
    selectFeedbackKind,
    goBack,
    setFeatureRequestChoice,
    setCustomFeatureRequestText,
    setFeedbackText,
    setIncludeLogs,
    resetFeedback,
    submitFeedback,
  } = useFeedback();
  const onboardingProviders = useMemo(
    () => selectedProviders,
    [selectedProviders],
  );
  const showDevControl = useDevControl();

  const workspaceCount = status?.workspaces.length ?? 0;
  const limit = status?.workspaceLimit ?? MAX_WORKSPACES;
  const atLimit = workspaceCount >= limit;
  const globalSyncEnabled = status?.globalSyncEnabled ?? true;
  const autoSyncNewChatsEnabled = status?.autoSyncNewChatsEnabled ?? true;

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
          <HomeView
            atLimit={atLimit}
            workspaceCount={workspaceCount}
            workspaces={status?.workspaces ?? []}
            onboardingProviders={onboardingProviders}
            version={popupVersion}
            globalSyncEnabled={globalSyncEnabled}
            loading={loading}
            busyKey={busyKey}
            onClearWorkspace={clearWorkspace}
            onClearProvider={clearProvider}
            onToggleGlobalSync={() => void toggleGlobalSync()}
          />
        ) : (
          <AdvancedView
            status={status}
            loading={loading}
            selectedProviders={selectedProviders}
            resolvedShortcuts={resolvedShortcuts}
            recordingShortcutId={recordingShortcutId}
            logActionBusy={logActionBusy}
            autoSyncNewChatsEnabled={autoSyncNewChatsEnabled}
            onOpenRequestModal={openRequestModal}
            onToggleDefaultProvider={(provider) => void toggleDefaultProvider(provider)}
            onToggleAutoSyncNewChats={() => void toggleAutoSyncNewChats()}
            onToggleCloseTabsOnDeleteSet={() => void toggleCloseTabsOnDeleteSet()}
            onResetIndicatorPositions={() => void resetIndicatorPositions()}
            onSetRecordingShortcutId={setRecordingShortcutId}
            onUpdateShortcut={(id, binding) => void updateShortcut(id, binding)}
            onResetShortcuts={() => void resetShortcuts()}
            onToggleDebugLogging={() => void toggleDebugLogging()}
            onDownloadLogs={() => void downloadLogs()}
            onClearLogs={() => void clearLogs()}
            onOpenTerms={() => {
              setActiveLegalPage('terms');
              setActiveView('legal');
            }}
            onOpenPrivacy={() => {
              setActiveLegalPage('privacy');
              setActiveView('legal');
            }}
          />
        )}
      </section>

      <RequestProvidersModal
        open={requestModalOpen}
        requestedProviders={requestedProviders}
        requestSubmitting={requestSubmitting}
        requestSubmitted={requestSubmitted}
        requestEndpointNotConfigured={requestEndpointNotConfigured}
        requestCooldownUntil={requestCooldownUntil}
        onToggleProvider={toggleRequestedProvider}
        onClose={closeRequestModal}
        onSubmit={() => void submitRequestModal()}
      />

      <FeedbackModal
        open={feedbackModalOpen}
        feedbackConfigured={feedbackConfigured}
        feedbackStep={feedbackStep}
        feedbackKind={feedbackKind}
        featureRequestChoice={featureRequestChoice}
        customFeatureRequestText={customFeatureRequestText}
        feedbackText={feedbackText}
        includeLogs={includeLogs}
        feedbackSubmitting={feedbackSubmitting}
        feedbackSubmitted={feedbackSubmitted}
        feedbackError={feedbackError}
        canSubmit={canSubmit}
        onClose={() => setFeedbackModalOpen(false)}
        onBack={goBack}
        onSelectFeedbackKind={selectFeedbackKind}
        onFeatureRequestChoiceChange={setFeatureRequestChoice}
        onCustomFeatureRequestTextChange={setCustomFeatureRequestText}
        onFeedbackTextChange={setFeedbackText}
        onIncludeLogsChange={setIncludeLogs}
        onSubmit={() => void submitFeedback()}
      />

      <DevToolsModal
        open={devModalOpen}
        busy={devActionBusy}
        onClose={() => setDevModalOpen(false)}
        onClearPersistentStorage={() => void handleClearPersistentStorage()}
        onResetRequestCooldown={resetRequestCooldownForDev}
      />
    </main>
  );
}
