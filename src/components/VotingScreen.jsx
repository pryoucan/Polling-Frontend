import { useEffect, useState } from 'react';
import { Timer } from './Timer.jsx';

export function VotingScreen({ state, skewRef, alreadyVoted, responses, onVote, notify }) {
  const q = state.question;
  const paused = !!state.paused;
  const [selection, setSelection] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Reset when a new question opens.
  useEffect(() => {
    setSelection([]);
    setSubmitted(false);
    setSubmitting(false);
  }, [q.id]);

  const locked = submitted || alreadyVoted || paused;

  function toggle(id) {
    if (locked) return;
    setSelection((sel) => {
      if (sel.includes(id)) return sel.filter((x) => x !== id);
      if (sel.length >= q.maxSelect) {
        notify(`You can select up to ${q.maxSelect}`);
        return sel;
      }
      return [...sel, id];
    });
  }

  async function submit(auto = false) {
    if (selection.length < q.minSelect || selection.length > q.maxSelect) return;
    setSubmitting(true);
    try {
      await onVote(q.id, selection);
      setSubmitted(true);
      notify(auto ? 'Time up — your answer was auto-submitted ✓' : 'Vote recorded ✓');
    } catch (e) {
      setSubmitting(false);
      notify(e.message);
    }
  }

  // Auto-submit at the deadline: if the user has a complete, valid selection but
  // hasn't pressed Submit, send it for them right as time runs out — it lands
  // inside the server's grace window so it still counts. A partial selection is
  // NOT auto-submitted (the server requires the exact count). Re-arms on every
  // selection change and on pause/resume (deadline shifts), so it always targets
  // the current closesAt with the latest picks.
  useEffect(() => {
    if (locked || paused || submitting) return undefined;
    if (selection.length < q.minSelect || selection.length > q.maxSelect) return undefined;
    const serverNow = Date.now() - (skewRef?.current || 0);
    const ms = Math.max(0, state.closesAt - serverNow);
    const t = setTimeout(() => submit(true), ms);
    return () => clearTimeout(t);
  }, [state.closesAt, paused, locked, submitting, selection, q.minSelect, q.maxSelect]);

  const canSubmit =
    !locked && !submitting && selection.length >= q.minSelect && selection.length <= q.maxSelect;

  return (
    <div className="card">
      <div className="eyebrow">
        Question {q.index + 1} of {state.total}
      </div>
      <div className="qprompt">{q.prompt}</div>
      <p className="hint">
        {q.minSelect === q.maxSelect
          ? `Select exactly ${q.maxSelect} option${q.maxSelect === 1 ? '' : 's'}.`
          : `Select ${q.minSelect}–${q.maxSelect} options.`}{' '}
        The most-voted answers win points.
      </p>

      <Timer
        opensAt={state.opensAt}
        closesAt={state.closesAt}
        skewRef={skewRef}
        paused={paused}
        pausedRemainingMs={state.pausedRemainingMs}
        rightText={responses != null ? `${responses} responses` : ''}
      />

      <div className="options">
        {q.options.map((o) => {
          const sel = selection.includes(o.id);
          const atMax = !sel && selection.length >= q.maxSelect;
          const disabled = locked || atMax;
          return (
            <div
              key={o.id}
              className={`option ${sel ? 'sel' : ''} ${disabled ? 'disabled' : ''}`.trim()}
              role="checkbox"
              aria-checked={sel}
              aria-disabled={disabled}
              aria-label={o.label}
              tabIndex={locked ? -1 : 0}
              onClick={() => toggle(o.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(o.id);
                }
              }}
            >
              <span className="box" />
              <span className="lbl">{o.label}</span>
            </div>
          );
        })}
      </div>

      <div className="actions">
        {paused ? (
          <span className="badge">⏸ Paused by host</span>
        ) : submitted || alreadyVoted ? (
          <span className="badge good">✓ Answer submitted — waiting for results</span>
        ) : (
          <span className="counter">
            Selected <b>{selection.length}</b> / {q.maxSelect}
          </span>
        )}
        <button className="btn" disabled={!canSubmit} onClick={() => submit()}>
          {paused ? 'Paused' : submitted || alreadyVoted ? 'Submitted' : submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
