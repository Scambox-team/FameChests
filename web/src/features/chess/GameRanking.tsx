import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { api } from '../../api/client';
import { fmtNum } from '../../lib/format';
import './gameRanking.css';

// Ranking jednej gry z zakładki Gry (serwer: routes/game_rankings.rs): szachy = wygrane z ludźmi, pinball = najlepszy sprawdzony
// wynik na danym poziomie. Pokazuje pierwsze miejsca, a gdy gracz jest dalej - jego miejsce na końcu.
type Row = { place: number; user: string; me: boolean; wins?: number; games?: number; losses?: number; draws?: number; best?: number };

export function GameRanking({ game, level, title, refresh }: { game: 'chess' | 'pinball' | 'aim'; level?: number; title: string; refresh?: unknown }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let alive = true;
    setRows(null);
    api<{ rows: Row[] }>(`/api/games/ranking?game=${game}${level ? `&level=${level}` : ''}`)
      .then(d => { if (alive) setRows(d.rows); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [game, level, refresh]);

  return (
    <section className="gr-box" aria-label={title}>
      <h3><Trophy size={16} aria-hidden="true" /> {title}</h3>
      {rows === null ? <p className="muted small">Wczytuję</p>
        : rows.length === 0 ? <p className="muted small">Nikt jeszcze nie ma tu wyniku.</p>
        : <ol className="gr-list">
          {rows.map((r, i) => (
            <li key={`${r.place}-${r.user}`} className={`${r.me ? 'is-me' : ''}${i > 0 && r.place - rows[i - 1].place > 1 ? ' gap' : ''}`}>
              <span className="gr-place">{r.place}</span>
              <Link className="gr-name" to={`/player/${encodeURIComponent(r.user)}`}>{r.user}</Link>
              {game === 'chess'
                ? <span className="gr-val"><b>{r.wins}</b> <small>{`wygr. z ${r.games}`}</small></span>
                : <span className="gr-val"><b>{fmtNum(r.best ?? 0)}</b> <small>pkt</small></span>}
            </li>
          ))}
        </ol>}
    </section>
  );
}
