import { getPid } from '../api.js';
import { Icon } from './Icon.jsx';

export function Leaderboard({ board, you }) {
  const myPid = getPid();
  return (
    <aside className="board">
      <h2>
        <span className="board-trophy">
          <Icon name="trophy" size={16} />
        </span>
        Leaderboard
      </h2>
      <ol className="board-list">
        {(!board || board.length === 0) && <li className="board-empty">No scores yet.</li>}
        {board?.map((row) => (
          <li
            key={row.id}
            className={`${row.rank === 1 ? 'r1' : ''} ${myPid && row.id === myPid ? 'me' : ''}`.trim()}
          >
            <span className="pos">#{row.rank}</span>
            <span className="nm">{row.name}</span>
            <span className="pts">{row.points}</span>
          </li>
        ))}
      </ol>
      {you && you.rank != null && (
        <div className="you">
          Your standing: <b>#{you.rank}</b> · <b>{you.points}</b> pts
        </div>
      )}
    </aside>
  );
}
