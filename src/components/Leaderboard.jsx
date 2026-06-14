import { getPid } from '../api.js';
import { Icon } from './Icon.jsx';

// Renders one ranked list (shared by the round and overall sections).
function BoardList({ rows, myPid, emptyText }) {
  return (
    <ol className="board-list">
      {(!rows || rows.length === 0) && <li className="board-empty">{emptyText}</li>}
      {rows?.map((row) => (
        <li
          key={row.id}
          className={`${row.rank === 1 ? 'r1' : ''} ${myPid && row.id === myPid ? 'me' : ''}`.trim()}
        >
          <span className="pos">#{row.rank}</span>
          <span className="nm">
            {row.name}
            {row.tag ? (
              <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 4 }}>··{row.tag}</span>
            ) : null}
          </span>
          <span className="pts">{row.points}</span>
        </li>
      ))}
    </ol>
  );
}

export function Leaderboard({ board, segment, you }) {
  const myPid = getPid();
  return (
    <aside className="board">
      {/* Current round (resets every block of questions) */}
      {segment && (
        <>
          <h2>
            <span className="board-trophy">
              <Icon name="trophy" size={16} />
            </span>
            This round · Q{segment.from + 1}–{segment.to + 1}
          </h2>
          <BoardList rows={segment.leaderboard} myPid={myPid} emptyText="No scores yet this round." />
        </>
      )}

      {/* Overall (whole poll) */}
      <h2 style={segment ? { marginTop: 18 } : undefined}>
        <span className="board-trophy">
          <Icon name="trophy" size={16} />
        </span>
        Overall
      </h2>
      <BoardList rows={board} myPid={myPid} emptyText="No scores yet." />

      {you && you.rank != null && (
        <div className="you">
          Overall standing: <b>#{you.rank}</b> · <b>{you.points}</b> pts
        </div>
      )}
    </aside>
  );
}
