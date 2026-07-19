export type LegalPage = 'terms' | 'privacy';

export function LegalContent({ page, onBack }: { page: LegalPage; onBack: () => void }) {
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
          <p className="askem-legal-updated">Last updated: June 2026</p>

          <h3>1. Acceptance</h3>
          <p>
            By installing or using the ask&apos;em browser extension (&quot;Extension&quot;), you
            agree to these Terms of Service. If you do not agree, please uninstall the Extension.
          </p>

          <h3>2. Description of Service</h3>
          <p>
            ask&apos;em is a browser extension that synchronizes prompts you type across multiple AI
            chat provider websites. The Extension operates primarily in your browser and interacts
            with third-party websites on your behalf.
          </p>

          <h3>3. Third-Party Services</h3>
          <p>
            The Extension interacts with third-party AI chat services (Claude, ChatGPT, Gemini,
            Kimi, DeepSeek, Manus, Grok). Your use of those services is governed by their respective terms.
            ask&apos;em is not affiliated with any of these providers.
          </p>

          <h3>4. Optional Support Submissions</h3>
          <p>
            If you choose to send feedback or request additional providers, the information you
            submit is sent to an ask&apos;em-operated support service. Feedback can include your
            message, images you choose to attach, attachment metadata, extension version, and
            bug-report context such as browser language and version, client timestamp, timezone,
            operating system, active tab title, and optional debug logs when you explicitly choose
            to include them. Provider requests can include selected provider names, a custom
            provider name you type, and extension version.
          </p>

          <h3>5. User Responsibilities</h3>
          <p>
            You are responsible for your prompts and for complying with each provider&apos;s terms.
            You must have valid accounts with the providers you use.
          </p>

          <h3>6. No Warranty</h3>
          <p>
            The Extension is provided &quot;as is&quot; without warranty of any kind. AI provider websites
            may change at any time, which may temporarily affect functionality.
          </p>

          <h3>7. Limitation of Liability</h3>
          <p>
            To the maximum extent permitted by law, the developers of ask&apos;em shall not be liable
            for any indirect, incidental, or consequential damages arising from your use of the
            Extension.
          </p>

          <h3>8. Changes</h3>
          <p>We may update these terms. Continued use after changes constitutes acceptance.</p>
        </div>
      ) : (
        <div className="askem-legal-body">
          <h2>Privacy Policy</h2>
          <p className="askem-legal-updated">Last updated: June 2026</p>

          <h3>1. Core Extension Data</h3>
          <p>
            ask&apos;em keeps its core sync state locally in your browser. This includes workspace
            state, provider conversation URLs and session identifiers, local settings, saved
            indicator positions, and local debug logs. Prompt attachments are staged locally in
            browser storage only long enough to deliver the current sync and are then released or
            expired.
          </p>

          <h3>2. Optional Remote Submissions</h3>
          <p>
            If you choose to send feedback or request more providers, that submission is sent to an
            ask&apos;em-operated support endpoint. Provider requests include the providers you select
            or type and the extension version. Feedback can include the message you write, images
            you attach, attachment metadata such as filename, content type, and file size, the
            extension version, and, for bug reports, browser language, browser version, client
            timestamp, timezone, operating system, and active tab title. Bug reports can also
            include a snapshot of local debug logs if you opt in.
          </p>

          <h3>3. Debug Logs</h3>
          <p>
            Debug logs are stored locally with size limits. Depending on what happened, they may
            include provider names, provider page URLs or session identifiers, prompt previews,
            attachment filenames and sizes, workspace state, delivery status, and failure details.
            They do not include raw attachment bytes. Debug logs are sent to ask&apos;em only when
            you submit a bug report with diagnostics enabled.
          </p>

          <h3>4. What Stays Out of Our Servers</h3>
          <p>
            Your prompts are forwarded between official provider tabs inside your browser. ask&apos;em
            does not send prompt content to its own servers as part of normal sync behavior.
          </p>

          <h3>5. Third-Party Interaction</h3>
          <p>
            When you use the Extension, your prompts are sent to third-party AI providers through
            their official web interfaces — exactly as if you typed them yourself. Each
            provider&apos;s own privacy policy governs how they handle your data.
          </p>

          <h3>6. Analytics &amp; Tracking</h3>
          <p>
            ask&apos;em does not include passive analytics or tracking. The only data sent to
            ask&apos;em-operated services is information you explicitly choose to submit, such as
            feedback or provider requests.
          </p>

          <h3>7. Permissions</h3>
          <p>The Extension requests only the permissions needed to work:</p>
          <ul>
            <li>
              <strong>storage</strong> — to save preferences and local extension state
            </li>
            <li>
              supported AI chat provider access — to capture your submitted prompt and sync it
              across provider tabs
            </li>
            <li>
              optional host permissions — only when you explicitly send feedback or a provider
              request to an ask&apos;em-operated endpoint
            </li>
          </ul>

          <h3>8. Contact</h3>
          <p>Questions about this policy? Reach us at one77r@gmail.com.</p>
        </div>
      )}
    </section>
  );
}
