import { useCallback, useEffect, useState } from 'react';
import {
  getAdminToken,
  setAdminToken,
  adminStatus,
  adminStart,
  adminStop,
  adminPause,
  adminResume,
  adminNext,
  adminReset,
  adminReseed,
  adminDownloadResults,
  adminLeaderboard,
  adminDownloadStandings,
} from './api.js';
import { useSse } from './useSse.js';
import { Icon } from './components/Icon.jsx';

// Two-step confirm button for destructive actions: first click arms it, second
// confirms. Auto-disarms after a few seconds. Avoids accidental data loss
// without a jarring native dialog.
function ConfirmButton({ icon, label, confirmLabel = 'Confirm', kind = 'danger', disabled, onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return (
      <button className={`btn ghost ${kind}`} disabled={disabled} onClick={() => setArmed(true)}>
        <Icon name={icon} /> {label}
      </button>
    );
  }
  return (
    <span className="confirm-pair">
      <button
        className={`btn ${kind}`}
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        <Icon name="check" /> {confirmLabel}
      </button>
      <button className="btn ghost sm" disabled={disabled} onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

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

const MEDALS = ['🥇', '🥈', '🥉'];

const PHASE_LABEL = {
  pending: 'Idle · standby',
  lobby: 'Lobby — ready to begin',
  voting: 'Voting open',
  results: 'Showing results',
  complete: 'Poll complete',
};

// Host control panel at /admin. Token is stored in localStorage and sent on
// every admin call. Buttons publish commands the backend primary acts on.
export default function Admin() {
  const [token, setToken] = useState(getAdminToken());
  const [authed, setAuthed] = useState(!!getAdminToken());
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState(null); // { kind: 'ok'|'err', text } | null
  const [busy, setBusy] = useState(false);
  const [seedCount, setSeedCount] = useState(100);
  const [board, setBoard] = useState([]);
  const [segBoard, setSegBoard] = useState(null); // current round leaderboard { index, from, to, leaderboard }
  const [startArmed, setStartArmed] = useState(false); // confirm gate for a destructive Start

  // Live feed (same public SSE stream participants use): current question,
  // per-option counts, and frozen results.
  const { state, tally, result } = useSse();

  // Auto-clear transient feedback messages.
  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  // Poll the leaderboard while authed (it only changes at question close, but a
  // light poll keeps it fresh without extra wiring).
  useEffect(() => {
    if (!authed) return undefined;
    const tick = () =>
      adminLeaderboard() // host endpoint — includes full phone numbers
        .then((r) => {
          setBoard(r.leaderboard || []);
          setSegBoard(r.segment || null);
        })
        .catch(() => {});
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
        setMsg({ kind: 'err', text: 'Invalid admin token' });
      }
    }
  }, []);

  // Poll status while authed.
  useEffect(() => {
    if (!authed) return undefined;
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [authed, refresh]);

  // Validate the token against the server BEFORE granting access.
  async function saveToken() {
    const t = token.trim();
    if (!t) return setMsg({ kind: 'err', text: 'Enter the admin token' });
    setAdminToken(t);
    setBusy(true);
    setMsg(null);
    try {
      await adminStatus(); // 401s if the token is wrong
      setAuthed(true);
    } catch (e) {
      setAuthed(false);
      setMsg({ kind: 'err', text: /unauthorized/i.test(e.message) ? 'Invalid admin token' : e.message });
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  async function run(label, fn) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: label });
      // Commands reach the clock asynchronously (via Redis pub/sub), so refresh
      // a couple of times to reflect the new phase promptly.
      setTimeout(refresh, 150);
      setTimeout(refresh, 600);
    } catch (e) {
      setMsg({ kind: 'err', text: e.message });
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
            <div className="badge">
              <Icon name="lock" size={13} /> Host access
            </div>
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
              {busy ? <span className="spinner" /> : null} {busy ? 'Checking…' : 'Continue'}
            </button>
            {msg && (
              <p className={`statusmsg ${msg.kind}`} role="status" aria-live="polite" style={{ marginTop: 12, justifyContent: 'center' }}>
                {msg.text}
              </p>
            )}
          </div>
        </main>
      </div>
    );
  }

  const phase = status?.phase ?? 'pending';
  const isPaused = !!status?.paused;
  const isLive = ['lobby', 'voting', 'results'].includes(phase);
  const isLastResults = phase === 'results' && status?.questionIndex === (status?.total ?? 0) - 1;
  const qInfo =
    status?.questionIndex != null
      ? `Q${status.questionIndex + 1} of ${status.total} — ${status.questionPrompt}`
      : `${status?.total ?? 0} questions loaded`;

  // The single contextual primary action — exactly one per phase.
  let primary;
  if (phase === 'voting') {
    primary = isPaused
      ? { icon: 'play', text: 'Resume', toast: 'Resumed', fn: adminResume }
      : { icon: 'pause', text: 'Pause', toast: 'Paused', fn: adminPause };
  } else if (phase === 'lobby') {
    primary = { icon: 'play', text: 'Begin first question', toast: 'Started first question', fn: adminNext };
  } else if (phase === 'results') {
    primary = isLastResults
      ? { icon: 'flag', text: 'Finish poll', toast: 'Poll finished', fn: adminNext }
      : { icon: 'next', text: 'Next question', toast: 'Advanced to next question', fn: adminNext };
  } else {
    primary = { icon: 'play', text: phase === 'complete' ? 'Restart poll' : 'Start poll', toast: 'Poll started', fn: adminStart };
  }

  const statusState = phase === 'voting' ? 'live' : phase === 'pending' ? 'idle' : 'connecting';
  const { total: liveTotal, opts: liveOpts } = liveOptions(state, tally, result, phase);
  const showLive = (phase === 'voting' || phase === 'results') && state?.question;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <span>Admin · {status?.title || 'Live Poll'}</span>
        </div>
        <div className="status" data-state={statusState}>
          {PHASE_LABEL[phase] || phase}
          {isPaused ? ' · paused' : ''}
        </div>
      </header>

      <main className="layout">
        <section className="stage">
          {/* Status banner — color-coded by phase */}
          <div className="card statusbanner" data-phase={phase}>
            <div className="sb-row">
              <div>
                <div className="eyebrow">Poll status</div>
                <div className="sb-phase">
                  {PHASE_LABEL[phase] || phase}
                  {isPaused && <span className="sb-paused">Paused</span>}
                </div>
                <p className="hint" style={{ margin: '4px 0 0' }}>{qInfo}</p>
              </div>
              {showLive && (
                <div className="sb-metric">
                  <b>{liveTotal}</b>
                  <span>response{liveTotal === 1 ? '' : 's'}</span>
                </div>
              )}
            </div>
          </div>

          {/* Run control — one primary CTA + secondary actions */}
          <div className="card">
            <div className="eyebrow">Run control</div>
            <div className="toolbar">
              {/* A Start/Restart that would erase existing scores must be confirmed.
                  A fresh start (no scores yet) stays a clean one-click. */}
              {primary.fn === adminStart && board.length > 0 ? (
                startArmed ? (
                  <span className="confirm-pair">
                    <button
                      className="btn btn-lg danger"
                      disabled={busy}
                      onClick={() => {
                        setStartArmed(false);
                        run(primary.toast, primary.fn);
                      }}
                    >
                      <Icon name="check" /> {primary.text} — clears scores
                    </button>
                    <button className="btn ghost sm" disabled={busy} onClick={() => setStartArmed(false)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button className="btn btn-lg" disabled={busy} onClick={() => setStartArmed(true)}>
                    <Icon name={primary.icon} /> {primary.text}
                  </button>
                )
              ) : (
                <button className="btn btn-lg" disabled={busy} onClick={() => run(primary.toast, primary.fn)}>
                  {busy ? <span className="spinner" /> : <Icon name={primary.icon} />} {primary.text}
                </button>
              )}
              {isLive && (
                <ConfirmButton
                  icon="reset"
                  label="Restart"
                  confirmLabel="Restart — clears scores"
                  kind="caution"
                  disabled={busy}
                  onConfirm={() => run('Poll restarted', adminStart)}
                />
              )}
              {isLive && (
                <ConfirmButton
                  icon="stop"
                  label="Stop"
                  confirmLabel="Stop poll"
                  kind="caution"
                  disabled={busy}
                  onConfirm={() => run('Poll stopped', adminStop)}
                />
              )}
            </div>
            {msg && (
              <p className={`statusmsg ${msg.kind}`} role="status" aria-live="polite">
                {msg.kind === 'ok' && <Icon name="check" />} {msg.text}
              </p>
            )}
          </div>

          {/* Per-question results — a clear ranked Top 10 the host can read out */}
          {showLive && (
            <div className="card">
              <div className="eyebrow">
                {phase === 'results' ? 'Top answers — final' : 'Top answers — live'} · Question{' '}
                {(state.question.index ?? 0) + 1}
              </div>
              <div className="qprompt" style={{ fontSize: 20 }}>
                {state.question.prompt}
              </div>
              <p className="hint">
                {liveTotal} response{liveTotal === 1 ? '' : 's'} · showing top {Math.min(10, liveOpts.length)} of{' '}
                {liveOpts.length}
              </p>
              {/* Single column + rank badges so it reads as a clear 1→10 ranking. */}
              <div className="options" style={{ gridTemplateColumns: '1fr' }}>
                {liveOpts.slice(0, 10).map((o, i) => (
                  <div key={i} className={`option ${o.win ? 'win' : ''}`.trim()}>
                    <span className="bar" style={{ width: `${o.pct}%` }} />
                    <span className="medal" style={{ minWidth: 26, marginRight: 4, fontWeight: 700 }}>
                      {i < 3 ? MEDALS[i] : `#${i + 1}`}
                    </span>
                    <span className="lbl">{o.label}</span>
                    <span className="count">
                      {o.votes} · {Math.round(o.pct)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Export */}
          <div className="card">
            <div className="eyebrow">Export results</div>
            <p className="hint">Per-question top-10 options, or full standings with phone numbers for prizes.</p>
            <div className="toolbar">
              <button className="btn ghost" disabled={busy} onClick={() => run('Downloaded CSV', () => adminDownloadResults('csv', 10))}>
                <Icon name="download" /> Answers CSV
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => run('Downloaded JSON', () => adminDownloadResults('json', 10))}>
                <Icon name="download" /> Answers JSON
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => run('Downloaded standings', adminDownloadStandings)}>
                <Icon name="download" /> Standings + phones
              </button>
            </div>
          </div>

          {/* Danger zone — destructive, confirmed actions */}
          <div className="card danger-zone">
            <div className="eyebrow danger">Danger zone</div>
            <p className="hint">These wipe data and can't be undone.</p>
            <div className="toolbar">
              <ConfirmButton
                icon="reset"
                label="Reset scores"
                confirmLabel="Reset scores"
                disabled={busy}
                onConfirm={() => run('Scores reset', adminReset)}
              />
              <span className="reseed-field">
                <label htmlFor="seedCount">Reseed with</label>
                <input
                  id="seedCount"
                  type="number"
                  min="1"
                  max="500"
                  value={seedCount}
                  onChange={(e) => setSeedCount(parseInt(e.target.value, 10) || 1)}
                />
                <span>questions</span>
                <ConfirmButton
                  icon="reseed"
                  label="Reseed"
                  confirmLabel={`Replace with ${seedCount}`}
                  disabled={busy}
                  onConfirm={() => run(`Reseeded ${seedCount} questions`, () => adminReseed(seedCount))}
                />
              </span>
            </div>
          </div>

          {/* Help */}
          <div className="card">
            <div className="eyebrow">How it works</div>
            <p className="hint" style={{ marginBottom: 0 }}>
              <b>Begin</b> fires the first question; each runs on its own timer, then holds on its results
              until you press <b>Next question</b> (the poll never auto-advances). To take a break and
              continue the <i>same</i> run, use <b>Pause</b>/<b>Resume</b> during a question — your votes and
              scores are kept. <b>Start</b> and <b>Restart</b> clear the previous run's scores (the app asks
              you to confirm first). <b>Stop</b> ends the run — the data stays in the DB for export, but
              resuming afterward requires <b>Start</b>, which clears. The <b>Danger zone</b> wipes
              votes/scores or replaces all questions.
            </p>
          </div>
        </section>

        {/* Live leaderboards — current round + overall */}
        <aside className="board">
          {segBoard && (
            <>
              <h2>This round · Q{segBoard.from + 1}–{segBoard.to + 1}</h2>
              <ol className="board-list">
                {(!segBoard.leaderboard || segBoard.leaderboard.length === 0) && (
                  <li className="board-empty">No scores yet this round.</li>
                )}
                {segBoard.leaderboard?.map((row) => (
                  <li key={row.id} className={row.rank === 1 ? 'r1' : ''}>
                    <span className="pos">#{row.rank}</span>
                    <span className="nm">
                      {row.name}
                      {row.phone ? (
                        <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 6 }}>{row.phone}</span>
                      ) : null}
                    </span>
                    <span className="pts">{row.points}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <h2 style={segBoard ? { marginTop: 18 } : undefined}>Overall leaderboard</h2>
          <ol className="board-list">
            {board.length === 0 && <li className="board-empty">No scores yet.</li>}
            {board.map((row) => (
              <li key={row.id} className={row.rank === 1 ? 'r1' : ''}>
                <span className="pos">#{row.rank}</span>
                <span className="nm">
                  {row.name}
                  {row.phone ? (
                    <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 6 }}>{row.phone}</span>
                  ) : null}
                </span>
                <span className="pts">{row.points}</span>
              </li>
            ))}
          </ol>
        </aside>
      </main>
    </div>
  );
}
