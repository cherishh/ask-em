import { startTransition, useEffect, useState } from 'react';

const DID_YOU_KNOW_TIPS = [
  'You can run up to three groups at a time.',
  'Closed a synced tab by mistake? Bring it back within 7 seconds and the group can keep its place.',
  'Found a bug? Turn on Trace Capture and send the exported log file over.',
] as const;

// Planned: keep this card dormant until we bring back the popup tip carousel.
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
