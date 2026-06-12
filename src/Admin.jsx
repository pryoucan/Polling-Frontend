import { useCallback, useEffect, useState } from 'react';
import {
  getAdminToken,
  setAdminToken,
  adminStatus,
  adminStart,
  adminStop,
  adminPause,
  adminResume,
  adminReset,
  adminReseed,
  adminDownloadResults,
  fetchLeaderboard,
} from './api.js';
import { useSse } from './useSse.js';

// Build the per-option live breakdown for the admin view.
//   results phase -> use the frozen result.tally (has labels + winners)
//   voting  phase -> use the live tally counts mapped onto the question options
function liveOptions(state, tally, result, phase) {
  if (!state?.question) return { total: 0, opts: [] };

  if (phase === 'results' && result?.questionId === state.question.id) {
    const total = result.tally.reduce((a, t) => a + t.votes, 0);
    const winners = new Set(result.winners.map((w) => w.optionId));
    const opts = result.tally.map((t) => ({
      label: t.label,
      votes: t.votes,
      pct: total ? (t.votes / total) * 100 : 0,
      win: winners.has(t.optionId),
    }));
    return { total, opts };
  }

  const counts = {};
  if (tally?.questionId === state.question.id) {
    for (const t of tally.tally) counts[t.optionId] = t.votes;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const opts = (state.question.options || [])
    .map((o) => ({
      label: o.label,
      votes: counts[o.id] || 0,
      pct: total ? ((counts[o.id] || 0) / total) * 100 : 0,
      win: false,
    }))
    .sort((a, b) => b.votes - a.votes);
  return { total, opts };
}

// Host control panel at /admin. Token is stored in localStorage and sent on
// every admin call. Buttons publish commands the backend primary acts on.
export default function Admin() {
  const [token, setToken] = useState(getAdminToken());
  const [authed, setAuthed] = useState(!!getAdminToken());
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [seedCount, setSeedCount] = useState(100);
  const [board, setBoard] = useState([]);

  // Live feed (same public SSE stream participants use): current question,
  // per-option counts, and frozen results.
  const { state, tally, result } = useSse();

  // Poll the leaderboard while authed (it only changes at question close, but a
  // light poll keeps it fresh without extra wiring).
  useEffect(() => {
    if (!authed) return;
    const tick = () => fetchLeaderboard(20).then((r) => setBoard(r.leaderboard || [])).catch(() => {});
    tick();
    const id = setInterval(tick, 2500);
    return () => clearInterval(id);
  }, [authed]);

  // Fetch current status; bounce to login if the token is invalid.
  const refresh = useCallback(async () => {
    try {
      setStatus(await adminStatus());
    } catch (e) {
      if (/unauthorized/i.test(e.message)) {
        setAuthed(false);
        setMsg('Invalid admin token');
      }
    }
  }, []);

  // Poll status while authed.
  useEffect(() => {
    if (!authed) return;
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [authed, refresh]);

  // Validate the token against the server BEFORE granting access.
  async function saveToken() {
    const t = token.trim();
    if (!t) return setMsg('Enter the admin token');
    setAdminToken(t);
    setBusy(true);
    setMsg('');
    try {
      await adminStatus(); // 401s if the token is wrong
      setAuthed(true);
    } catch (e) {
      setAuthed(false);
      setMsg(/unauthorized/i.test(e.message) ? 'Invalid admin token' : e.message);
    } finally {
      setBusy(false);
    }
  }

  async function run(label, fn) {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      setMsg(`✓ ${label}`);
      // Commands reach the clock asynchronously (via Redis pub/sub), so refresh
      // a couple of times to reflect the new phase promptly instead of waiting
      // for the next 2s poll.
      setTimeout(refresh, 150);
      setTimeout(refresh, 600);
    } catch (e) {
      setMsg(`✗ ${e.message}`);
      if (/unauthorized/i.test(e.message)) setAuthed(false);
    } finally {
      setBusy(false);
    }
  }

  if (!authed) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="dot" />
            <span>Admin · Live Poll</span>
          </div>
        </header>
        <main className="layout" style={{ gridTemplateColumns: '1fr' }}>
          <div className="card join">
            <div className="badge">Host access</div>
            <h1>Admin panel</h1>
            <p>Enter the admin token to control the poll.</p>
            <input
              className="input"
              type="password"
              placeholder="Admin token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveToken()}
              autoFocus
            />
            <button className="btn full" disabled={busy} onClick={saveToken}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
            {msg && <p className="hint" style={{ marginTop: 12 }}>{msg}</p>}
          </div>
        </main>
      </div>
    );
  }

  const phase = status?.phase ?? '…';
  const isPaused = !!status?.paused;
  const isLive = ['lobby', 'voting', 'results'].includes(phase);
  const qInfo =
    status?.questionIndex != null
      ? `Q${status.questionIndex + 1}/${status.total} — ${status.questionPrompt}`
      : `${status?.total ?? 0} questions loaded`;

  const { total: liveTotal, opts: liveOpts } = liveOptions(state, tally, result, phase);
  const showLive = (phase === 'voting' || phase === 'results') && state?.question;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <span>Admin · {status?.title || 'Live Poll'}</span>
        </div>
        <div className="status" data-state="live">
          phase: {phase}
          {isPaused ? ' (paused)' : ''}
        </div>
      </header>

      <main className="layout">
        <section className="stage">
          {/* Controls */}
          <div className="card">
            <div className="eyebrow">Poll status</div>
            <div className="qprompt" style={{ fontSize: 22 }}>
              {phase.toUpperCase()}
              {isPaused && <span style={{ color: 'var(--accent)' }}> · PAUSED</span>}
            </div>
            <p className="hint">{qInfo}</p>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn" disabled={busy} onClick={() => run('started', adminStart)}>
                ▶ Start / Restart
              </button>
              {/* Always rendered (disabled when not live) so the row never reflows. */}
              <button
                className="btn ghost"
                style={{ minWidth: 120 }}
                disabled={busy || !isLive}
                onClick={() => (isPaused ? run('resumed', adminResume) : run('paused', adminPause))}
              >
                {isPaused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => run('stopped', adminStop)}>
                ⏹ Stop
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => run('reset', adminReset)}>
                ↺ Reset scores
              </button>
            </div>

            <div className="actions" style={{ marginTop: 22 }}>
              <span className="counter">
                Reseed with{' '}
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={seedCount}
                  onChange={(e) => setSeedCount(parseInt(e.target.value, 10) || 1)}
                  style={{ width: 70, padding: '6px 8px', borderRadius: 8, border: '1.5px solid var(--line)' }}
                />{' '}
                questions
              </span>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => run(`reseeded ${seedCount}`, () => adminReseed(seedCount))}
              >
                ⟳ Reseed
              </button>
            </div>

            <div className="actions" style={{ marginTop: 14 }}>
              <span className="counter">Export top-10 of every question</span>
              <span style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => run('downloaded CSV', () => adminDownloadResults('csv', 10))}
                >
                  ⬇ CSV
                </button>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => run('downloaded JSON', () => adminDownloadResults('json', 10))}
                >
                  ⬇ JSON
                </button>
              </span>
            </div>

            {msg && (
              <p className="hint" style={{ marginTop: 16 }}>
                {msg}
              </p>
            )}
          </div>

          {/* Live results for the current question */}
          {showLive && (
            <div className="card">
              <div className="eyebrow">
                {phase === 'results' ? 'Final tally' : 'Live votes'} · Question{' '}
                {(state.question.index ?? 0) + 1}
              </div>
              <div className="qprompt" style={{ fontSize: 20 }}>
                {state.question.prompt}
              </div>
              <p className="hint">{liveTotal} response{liveTotal === 1 ? '' : 's'} so far</p>
              <div className="options">
                {liveOpts.map((o, i) => (
                  <div key={i} className={`option ${o.win ? 'win' : ''}`.trim()}>
                    <span className="bar" style={{ width: `${o.pct}%` }} />
                    <span className="lbl">{o.label}</span>
                    <span className="count">
                      {o.votes} · {Math.round(o.pct)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Help */}
          <div className="card">
            <div className="eyebrow">How it works</div>
            <p className="hint" style={{ marginBottom: 0 }}>
              <b>Start</b> clears the previous run's scores and runs the poll from the lobby.
              <b> Pause</b> freezes the current question with its remaining time intact;{' '}
              <b>Resume</b> continues from exactly there. <b>Stop</b> returns everyone to the
              standby screen. <b>Reset</b> wipes votes/scores (participants stay registered).{' '}
              <b>Reseed</b> replaces the questions entirely.
            </p>
          </div>
        </section>

        {/* Live leaderboard */}
        <aside className="board">
          <h2>Live leaderboard</h2>
          <ol className="board-list">
            {board.length === 0 && <li className="board-empty">No scores yet.</li>}
            {board.map((row) => (
              <li key={row.id} className={row.rank === 1 ? 'r1' : ''}>
                <span className="pos">#{row.rank}</span>
                <span className="nm">{row.name}</span>
                <span className="pts">{row.points}</span>
              </li>
            ))}
          </ol>
        </aside>
      </main>
    </div>
  );
}
