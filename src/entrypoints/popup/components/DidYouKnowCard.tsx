import { startTransition, useEffect, useState } from 'react';

const DID_YOU_KNOW_TIPS = [
  'Use Cmd/Ctrl + . to pause or restart sync for the current tab, and Cmd/Ctrl + Shift + . to toggle global sync.',
  'Closed a provider in a set by mistake? The next prompt can reopen it automatically, so you can keep moving.',
  'Global Sync Off keeps prompts local and stops new set fan-out until you turn it back on.',
  'Click the standalone indicator on a fresh chat to toggle global sync instantly without opening the popup.',
  'No Live Tab means a provider still belongs to the set, but no live tab is attached right now.',
  'Turn on Trace Capture only when debugging, then export the JSON log file when you need to report a bug.',
] as const;

export function DidYouKnowCard() {
  const [tipIndex, setTipIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) {
      return;
    }

    const intervalId = window.setInterval(() => {
      startTransition(() => {
        setTipIndex((current) => (current + 1) % DID_YOU_KNOW_TIPS.length);
      });
    }, 10_000);

    return () => window.clearInterval(intervalId);
  }, [paused]);

  return (
    <section
      className="askem-facts-card"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="askem-facts-top">
        <p className="askem-card-label">Did You Know</p>
        <div className="askem-facts-dots" aria-hidden="true">
          {DID_YOU_KNOW_TIPS.map((_, index) => (
            <span key={index} className={index === tipIndex ? 'is-active' : ''} />
          ))}
        </div>
      </div>
      <p key={tipIndex} className="askem-facts-copy">
        {DID_YOU_KNOW_TIPS[tipIndex]}
      </p>
    </section>
  );
}
