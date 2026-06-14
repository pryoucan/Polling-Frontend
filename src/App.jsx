import { useEffect, useRef, useState } from 'react';
import { useSse } from './useSse.js';
import { join, vote, fetchState, fetchLeaderboard, getName, clearSession } from './api.js';
import { Leaderboard } from './components/Leaderboard.jsx';
import { VotingScreen } from './components/VotingScreen.jsx';
import { ResultsScreen } from './components/ResultsScreen.jsx';
import { Icon } from './components/Icon.jsx';
import Admin from './Admin.jsx';

export default function App() {
  // Tiny router: the host panel lives at /admin (no react-router needed).
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
    return <Admin />;
  }
  return <PollApp />;
}

function PollApp() {
  const { state, result, tally, connected, skewRef } = useSse();
  const [name, setName] = useState(getName());
  const [you, setYou] = useState(null);
  const [youVoted, setYouVoted] = useState(false);
  const [board, setBoard] = useState([]);
  const [segment, setSegment] = useState(null); // { index, size, from, to, leaderboard } — current 10-Q round
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  function notify(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }

  // Seed the leaderboard on mount so a refresh shows it immediately (it isn't
  // broadcast during the voting phase).
  useEffect(() => {
    fetchLeaderboard(20)
      .then((r) => {
        if (r.leaderboard?.length) setBoard(r.leaderboard);
        if (r.segment) setSegment(r.segment);
      })
      .catch(() => {});
  }, []);

  // Keep both leaderboards fresh from whichever source last carried them.
  useEffect(() => {
    if (result?.leaderboard) setBoard(result.leaderboard);
    if (result?.segment) setSegment({ ...result.segment, leaderboard: result.segmentLeaderboard || [] });
  }, [result]);
  useEffect(() => {
    if (state?.leaderboard) setBoard(state.leaderboard);
    else if (state?.phase === 'lobby') setBoard([]); // fresh run — Start just cleared all scores
    // Only show the round panel during an active round (voting/results). Clear it
    // in lobby/idle/complete so a stale round doesn't linger after Stop or between runs.
    if (state?.segment && (state.phase === 'voting' || state.phase === 'results')) {
      setSegment({ ...state.segment, leaderboard: state.segmentLeaderboard || [] });
    } else if (state && state.phase !== 'voting' && state.phase !== 'results') {
      setSegment(null);
    }
  }, [state]);

  // Per-user info (you / youVoted) isn't in the broadcast — fetch it on phase
  // and question changes.
  const phase = state?.phase;
  const qId = state?.question?.id;
  useEffect(() => {
    if (!name || !phase) return;
    fetchState()
      .then((st) => {
        setYouVoted(typeof st.youVoted === 'boolean' ? st.youVoted : false);
        if (st.you) setYou(st.you);
      })
      .catch(() => {});
  }, [phase, qId, name]);

  async function handleJoin(n, phone) {
    const r = await join(n, phone);
    setName(r.name);
  }

  async function handleVote(questionId, optionIds) {
    try {
      await vote(questionId, optionIds);
      setYouVoted(true);
    } catch (e) {
      // The server says this token's participant no longer exists (e.g. the DB
      // was reset). Drop the stale identity and send them back to Join.
      if (e.code === 'REJOIN') {
        clearSession();
        setName(null);
        notify('Session expired — please re-enter your name');
        return;
      }
      throw e;
    }
  }

  const responses =
    tally && state?.question && tally.questionId === state.question.id
      ? tally.tally.reduce((a, t) => a + (t.votes || 0), 0)
      : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <span>{state?.title || 'Live Poll'}</span>
        </div>
        <div className="status" data-state={connected ? 'live' : 'connecting'}>
          {connected ? 'live' : 'connecting…'}
        </div>
      </header>

      <main className="layout">
        <section className="stage">
          {!name ? (
            <Join onJoin={handleJoin} notify={notify} />
          ) : (
            <Stage
              state={state}
              result={result}
              skewRef={skewRef}
              youVoted={youVoted}
              responses={responses}
              onVote={handleVote}
              notify={notify}
            />
          )}
        </section>

        <Leaderboard board={board} segment={segment} you={you} />
      </main>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}

function Stage({ state, result, skewRef, youVoted, responses, onVote, notify }) {
  if (!state) return <Pending />;
  switch (state.phase) {
    case 'lobby':
      return <Lobby state={state} />;
    case 'voting':
      return (
        <VotingScreen
          state={state}
          skewRef={skewRef}
          alreadyVoted={youVoted}
          responses={responses}
          onVote={onVote}
          notify={notify}
        />
      );
    case 'results': {
      // Prefer the live 'result' event; on reconnect fall back to the tally
      // carried in the state snapshot.
      const r =
        result && result.questionId === state.question?.id
          ? result
          : state.tally
            ? { questionId: state.question?.id, tally: state.tally, winners: state.winners || [] }
            : null;
      return <ResultsScreen state={state} result={r} />;
    }
    case 'complete':
      return <Complete state={state} />;
    default:
      return <Pending />;
  }
}

function Join({ onJoin, notify }) {
  const [value, setValue] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    const n = value.trim();
    if (!n) return notify('Enter a name');
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) return notify('Enter a valid 10-digit phone number');
    setBusy(true);
    try {
      await onJoin(n, digits);
    } catch (e) {
      setBusy(false);
      notify(e.message);
    }
  }

  return (
    <div className="card join">
      <div className="badge">
        <Icon name="users" size={13} /> Join the poll
      </div>
      <h1>Pick your favourites</h1>
      <p>
        Enter your name and phone to play. Each question runs on a timer — pick the popular answers
        to score points.
      </p>
      <input
        className="input"
        placeholder="Your display name"
        maxLength={40}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go()}
        autoFocus
      />
      <input
        className="input"
        type="tel"
        inputMode="numeric"
        placeholder="10-digit phone number"
        maxLength={15}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go()}
        style={{ marginTop: 10 }}
      />
      <p className="hint" style={{ margin: '6px 0 0' }}>
        Only used to contact prize winners — enter a correct number to claim rewards.
      </p>
      <button className="btn full" disabled={busy} onClick={go} style={{ marginTop: 12 }}>
        {busy ? <span className="spinner" /> : null}
        {busy ? 'Joining…' : 'Enter'}
        {!busy && <Icon name="arrowRight" />}
      </button>
    </div>
  );
}

function Pending() {
  return (
    <div className="card center">
      <div className="badge">
        <span className="pulse-dot" /> Standby
      </div>
      <div className="waiting-icon">
        <Icon name="clock" size={44} />
      </div>
      <div className="waiting-sub">Waiting for the host to start the poll…</div>
    </div>
  );
}

function Lobby({ state }) {
  return (
    <div className="card center">
      <div className="badge">
        <span className="pulse-dot" /> Get ready
      </div>
      <div className="big-timer">{state.total ?? '—'}</div>
      <div className="waiting-sub">
        {state.total ? `${state.total} questions queued · ` : ''}
        waiting for the host to begin…
      </div>
    </div>
  );
}

function Complete({ state }) {
  const top = state.leaderboard?.[0];
  return (
    <div className="card center">
      <div className="badge good">
        <Icon name="check" size={13} /> Poll complete
      </div>
      <div className="trophy">
        <Icon name="trophy" size={48} />
      </div>
      <h1 style={{ marginTop: 4 }}>{top ? `${top.name} wins!` : 'Thanks for playing!'}</h1>
      {top && <div className="waiting-sub">{top.points} points</div>}
      <p className="hint" style={{ marginTop: 10 }}>
        Full standings are on the leaderboard.
      </p>
    </div>
  );
}
