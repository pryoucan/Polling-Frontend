import { useEffect, useRef, useState } from 'react';
import { useSse } from './useSse.js';
import { join, vote, fetchState, fetchLeaderboard, getName } from './api.js';
import { Leaderboard } from './components/Leaderboard.jsx';
import { VotingScreen } from './components/VotingScreen.jsx';
import { ResultsScreen } from './components/ResultsScreen.jsx';
import { BigCountdown } from './components/Timer.jsx';
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
      .then((r) => r.leaderboard?.length && setBoard(r.leaderboard))
      .catch(() => {});
  }, []);

  // Keep the leaderboard fresh from whichever source last carried it.
  useEffect(() => {
    if (result?.leaderboard) setBoard(result.leaderboard);
  }, [result]);
  useEffect(() => {
    if (state?.leaderboard) setBoard(state.leaderboard);
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

  async function handleJoin(n) {
    const r = await join(n);
    setName(r.name);
  }

  async function handleVote(questionId, optionIds) {
    await vote(questionId, optionIds);
    setYouVoted(true);
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

        <Leaderboard board={board} you={you} />
      </main>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}

function Stage({ state, result, skewRef, youVoted, responses, onVote, notify }) {
  if (!state) return <Pending />;
  switch (state.phase) {
    case 'lobby':
      return <Lobby state={state} skewRef={skewRef} />;
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
      return <ResultsScreen state={state} result={r} skewRef={skewRef} />;
    }
    case 'complete':
      return <Complete state={state} />;
    default:
      return <Pending />;
  }
}

function Join({ onJoin, notify }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    const n = value.trim();
    if (!n) return notify('Enter a name');
    setBusy(true);
    try {
      await onJoin(n);
    } catch (e) {
      setBusy(false);
      notify(e.message);
    }
  }

  return (
    <div className="card join">
      <div className="badge">Join the poll</div>
      <h1>Pick your favourites</h1>
      <p>
        Enter a display name to play. Each question runs on a timer — pick the popular answers to
        score points.
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
      <button className="btn full" disabled={busy} onClick={go}>
        {busy ? 'Joining…' : 'Enter'}
      </button>
    </div>
  );
}

function Pending() {
  return (
    <div className="card center">
      <div className="badge">Standby</div>
      <div className="big-timer">—</div>
      <div className="waiting-sub">Waiting for the host to start the poll…</div>
    </div>
  );
}

function Lobby({ state, skewRef }) {
  return (
    <div className="card center">
      <div className="badge">Welcome</div>
      <div className="big-timer">
        <BigCountdown
          closesAt={state.closesAt}
          skewRef={skewRef}
          paused={state.paused}
          pausedRemainingMs={state.pausedRemainingMs}
        />
      </div>
      <div className="waiting-sub">
        {state.paused ? 'Paused by host' : 'The first question is about to begin'}
      </div>
    </div>
  );
}

function Complete({ state }) {
  const top = state.leaderboard?.[0];
  return (
    <div className="card center">
      <div className="badge good">Poll complete</div>
      <h1 style={{ marginTop: 14 }}>{top ? `🏆 ${top.name} wins!` : 'Thanks for playing!'}</h1>
      {top && <div className="waiting-sub">{top.points} points</div>}
      <p className="hint" style={{ marginTop: 10 }}>
        Full standings are on the leaderboard.
      </p>
    </div>
  );
}
