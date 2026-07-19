import { useCallback, useState } from 'react';
import {
  DEFAULT_SHOW_DIAGNOSTICS,
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
    providerOptions,
    defaultFanOutSelectedProviders,
    resolvedShortcuts,
    refresh,
    clearWorkspace,
    clearProvider,
    toggleDefaultFanOutProvider,
    toggleGlobalSync,
    updatePopupProviderOrder,
    resetPopupProviderOrder,
    togglePauseAfterFirstFanOut,
    toggleCloseTabsOnDeleteSet,
    toggleShowDiagnostics,
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
    otherProviderText,
    requestSubmitting,
    requestSubmitted,
    requestEndpointNotConfigured,
    requestCooldownUntil,
    toggleRequestedProvider,
    setOtherProviderText,
    openRequestModal,
    closeRequestModal,
    submitRequestModal,
    resetRequestCooldownForDev,
  } = useProviderRequest();
  const {
    feedbackConfigured,
    feedbackStep,
    feedbackKind,
    feedbackText,
    includeLogs,
    attachments,
    attachmentError,
    feedbackSubmitting,
    feedbackSubmitted,
    feedbackError,
    canSubmit,
    selectFeedbackKind,
    goBack,
    addAttachmentFiles,
    removeAttachment,
    setFeedbackText,
    setIncludeLogs,
    resetFeedback,
    submitFeedback,
  } = useFeedback();
  const showDevControl = useDevControl();

  const workspaceCount = status?.workspaces.length ?? 0;
  const limit = status?.workspaceLimit ?? MAX_WORKSPACES;
  const atLimit = workspaceCount >= limit;
  const globalSyncEnabled = status?.globalSyncEnabled ?? true;

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
            <p className="askem-slogan">Use the real ChatGPT, Claude, Gemini and more all at once — full features, zero compromise.</p>
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
            Settings
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
            providerOptions={providerOptions}
            selectedProviders={defaultFanOutSelectedProviders}
            version={popupVersion}
            globalSyncEnabled={globalSyncEnabled}
            loading={loading}
            busyKey={busyKey}
            onClearWorkspace={clearWorkspace}
            onClearProvider={clearProvider}
            onToggleGlobalSync={() => void toggleGlobalSync()}
            onToggleDefaultFanOutProvider={(provider) => void toggleDefaultFanOutProvider(provider)}
          />
        ) : (
          <AdvancedView
            status={status}
            loading={loading}
            providerOptions={providerOptions}
            selectedProviders={defaultFanOutSelectedProviders}
            resolvedShortcuts={resolvedShortcuts}
            recordingShortcutId={recordingShortcutId}
            logActionBusy={logActionBusy}
            showDiagnostics={status?.showDiagnostics ?? DEFAULT_SHOW_DIAGNOSTICS}
            onOpenRequestModal={openRequestModal}
            onToggleProvider={(provider) => void toggleDefaultFanOutProvider(provider)}
            onUpdateProviderOrder={(providers) => void updatePopupProviderOrder(providers)}
            onResetProviderOrder={() => void resetPopupProviderOrder()}
            onTogglePauseAfterFirstFanOut={() => void togglePauseAfterFirstFanOut()}
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
        otherProviderText={otherProviderText}
        requestSubmitting={requestSubmitting}
        requestSubmitted={requestSubmitted}
        requestEndpointNotConfigured={requestEndpointNotConfigured}
        requestCooldownUntil={requestCooldownUntil}
        onToggleProvider={toggleRequestedProvider}
        onOtherProviderTextChange={setOtherProviderText}
        onClose={closeRequestModal}
        onSubmit={() => void submitRequestModal()}
      />

      <FeedbackModal
        open={feedbackModalOpen}
        feedbackConfigured={feedbackConfigured}
        feedbackStep={feedbackStep}
        feedbackKind={feedbackKind}
        feedbackText={feedbackText}
        includeLogs={includeLogs}
        attachments={attachments}
        attachmentError={attachmentError}
        feedbackSubmitting={feedbackSubmitting}
        feedbackSubmitted={feedbackSubmitted}
        feedbackError={feedbackError}
        canSubmit={canSubmit}
        onClose={() => setFeedbackModalOpen(false)}
        onBack={goBack}
        onSelectFeedbackKind={selectFeedbackKind}
        onAddAttachments={addAttachmentFiles}
        onFeedbackTextChange={setFeedbackText}
        onIncludeLogsChange={setIncludeLogs}
        onRemoveAttachment={removeAttachment}
        onSubmit={() => void submitFeedback()}
      />

      <DevToolsModal
        open={devModalOpen}
        busy={devActionBusy}
        showDiagnostics={status?.showDiagnostics ?? DEFAULT_SHOW_DIAGNOSTICS}
        onClose={() => setDevModalOpen(false)}
        onClearPersistentStorage={() => void handleClearPersistentStorage()}
        onResetRequestCooldown={resetRequestCooldownForDev}
        onToggleShowDiagnostics={() => void toggleShowDiagnostics()}
      />
    </main>
  );
}
