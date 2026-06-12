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

  async function submit() {
    if (selection.length < q.minSelect) return;
    setSubmitting(true);
    try {
      await onVote(q.id, selection);
      setSubmitted(true);
      notify('Vote recorded ✓');
    } catch (e) {
      setSubmitting(false);
      notify(e.message);
    }
  }

  const canSubmit =
    !locked && !submitting && selection.length >= q.minSelect && selection.length <= q.maxSelect;

  return (
    <div className="card">
      <div className="eyebrow">
        Question {q.index + 1} of {state.total}
      </div>
      <div className="qprompt">{q.prompt}</div>
      <p className="hint">
        Select {q.minSelect}–{q.maxSelect} options. The most-voted answers win points.
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
          return (
            <div
              key={o.id}
              className={`option ${sel ? 'sel' : ''} ${locked || atMax ? 'disabled' : ''}`.trim()}
              onClick={() => toggle(o.id)}
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
        <button className="btn" disabled={!canSubmit} onClick={submit}>
          {paused ? 'Paused' : submitted || alreadyVoted ? 'Submitted' : submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
