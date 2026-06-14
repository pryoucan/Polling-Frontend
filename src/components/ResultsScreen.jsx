const MEDALS = ['🥇', '🥈', '🥉'];

// Shows the frozen tally for the just-closed question. `result` is the last
// 'result' SSE message; `state` is the current 'results'-phase state. The phase
// is held until the host advances — there is no countdown.
export function ResultsScreen({ state, result }) {
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

  // At the end of a 10-question block, surface the round's top 3 for the prize moment.
  const segWinners = state.segmentEnd ? state.segmentLeaderboard || [] : [];

  return (
    <>
      {segWinners.length > 0 && (
        <div className="card center">
          <div className="badge good" style={{ marginBottom: 10 }}>
            🏆 Round {(state.segment?.index ?? 0) + 1} complete · Q{(state.segment?.from ?? 0) + 1}–
            {(state.segment?.to ?? 0) + 1}
          </div>
          <h2 style={{ margin: '2px 0 10px' }}>Round winners</h2>
          <ol className="board-list" style={{ maxWidth: 440, margin: '0 auto' }}>
            {segWinners.slice(0, 3).map((r, i) => (
              <li key={r.id} className={i === 0 ? 'r1' : ''}>
                <span className="pos">{MEDALS[i]}</span>
                <span className="nm">{r.name}</span>
                <span className="pts">{r.points}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="card">
        <div className="eyebrow">Results · Question {(q.index ?? 0) + 1}</div>
      <div className="qprompt">{q.prompt || 'Results'}</div>
      <p className="hint">Top answers are highlighted.</p>

      <div className="badge" style={{ marginBottom: 14 }}>
        Waiting for the host to continue…
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
    </>
  );
}
