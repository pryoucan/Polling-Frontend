import { useEffect, useState } from 'react';

// Shrinking bar + "Ns left". Aligns to the server clock via skewRef so all
// clients see the same countdown regardless of local clock drift.
export function Timer({ opensAt, closesAt, skewRef, rightText, paused, pausedRemainingMs }) {
  const [, force] = useState(0);

  useEffect(() => {
    if (paused) return; // frozen — no need to tick
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [closesAt, paused]);

  const serverNow = Date.now() - (skewRef?.current || 0);
  const total = Math.max(1, closesAt - opensAt);
  // When paused, hold the remaining time the server froze.
  const remain = paused ? Math.max(0, pausedRemainingMs || 0) : Math.max(0, closesAt - serverNow);
  const pct = (remain / total) * 100;
  const secs = Math.ceil(remain / 1000);

  const cls = paused
    ? 'timerfill'
    : pct <= 20
      ? 'timerfill danger'
      : pct <= 50
        ? 'timerfill warn'
        : 'timerfill';

  return (
    <div className="timerwrap">
      <div className="timerbar">
        <div className={cls} style={{ width: `${pct}%`, opacity: paused ? 0.5 : 1 }} />
      </div>
      <div className="timertext">
        <span>{paused ? `⏸ Paused · ${secs}s left` : remain <= 0 ? "Time's up" : `${secs}s left`}</span>
        <span>{rightText || ''}</span>
      </div>
    </div>
  );
}

// Big numeric countdown (lobby / results interlude).
export function BigCountdown({ closesAt, skewRef, paused, pausedRemainingMs }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [closesAt, paused]);
  const serverNow = Date.now() - (skewRef?.current || 0);
  const secs = paused
    ? Math.max(0, Math.ceil((pausedRemainingMs || 0) / 1000))
    : Math.max(0, Math.ceil((closesAt - serverNow) / 1000));
  return <span>{paused ? `⏸ ${secs}s` : `${secs}s`}</span>;
}
