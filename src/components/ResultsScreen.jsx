import { BigCountdown } from './Timer.jsx';

const MEDALS = ['🥇', '🥈', '🥉'];

// Shows the frozen tally for the just-closed question. `result` is the last
// 'result' SSE message; `state` is the current 'results'-phase state.
export function ResultsScreen({ state, result, skewRef }) {
  const q = state.question || {};

  // If the result message hasn't arrived yet, show a brief scoring placeholder.
  if (!result || result.questionId !== q.id) {
    return (
      <div className="card center">
        <div className="badge">Scoring</div>
        <div className="big-timer">…</div>
        <div className="waiting-sub">Tallying votes…</div>
      </div>
    );
  }

  const winnerIds = new Set(result.winners.map((w) => w.optionId));
  const maxVotes = Math.max(1, ...result.tally.map((t) => t.votes));

  return (
    <div className="card">
      <div className="eyebrow">Results · Question {(q.index ?? 0) + 1}</div>
      <div className="qprompt">{q.prompt || 'Results'}</div>
      <p className="hint">Top answers are highlighted. Next question starts shortly.</p>

      <div className="badge" style={{ marginBottom: 14 }}>
        Next question in{' '}
        <BigCountdown
          closesAt={state.closesAt}
          skewRef={skewRef}
          paused={state.paused}
          pausedRemainingMs={state.pausedRemainingMs}
        />
      </div>

      <div className="options">
        {result.tally.slice(0, 12).map((t) => {
          const isWin = winnerIds.has(t.optionId);
          return (
            <div key={t.optionId} className={`option ${isWin ? 'win' : ''}`.trim()}>
              <span className="bar" style={{ width: `${(t.votes / maxVotes) * 100}%` }} />
              {isWin && t.rank <= 3 && <span className="medal">{MEDALS[t.rank - 1]}</span>}
              <span className="lbl">{t.label}</span>
              <span className="count">{t.votes}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
