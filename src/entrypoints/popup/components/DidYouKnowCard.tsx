import { startTransition, useEffect, useState } from 'react';

const DID_YOU_KNOW_TIPS = [
  'Use Cmd/Ctrl + . to pause or restart sync for the current tab, and Cmd/Ctrl + Shift + . to toggle global sync.',
  'Closed a provider in a set by mistake? The next prompt can reopen it automatically, so you can keep moving.',
  'Global Sync Off keeps prompts local and stops new sets from syncing until you turn it back on.',
  'Click the standalone indicator on a fresh chat to toggle global sync instantly without opening the popup.',
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
        <div className="askem-facts-dots" aria-label="Switch tip">
          {DID_YOU_KNOW_TIPS.map((_, index) => (
            <button
              key={index}
              className={index === tipIndex ? 'is-active' : ''}
              onClick={() => setTipIndex(index)}
              type="button"
              aria-label={`Show tip ${index + 1}`}
              aria-pressed={index === tipIndex}
            />
          ))}
        </div>
      </div>
      <p key={tipIndex} className="askem-facts-copy">
        {DID_YOU_KNOW_TIPS[tipIndex]}
      </p>
    </section>
  );
}
