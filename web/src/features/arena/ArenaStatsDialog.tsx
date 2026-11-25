import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { person } from '../../game/rules';
import { S, touch, useGame } from '../../game/store';
import { Modal } from '../../ui/Modal';
import { abilityText, KIND_NAMES, rangeText, type ArenaCardStats } from './abilities';
import './arenaStats.css';

/** Okno „Statystyki areny” z podglądu karty: jawne statystyki (ukryte cechy widzi tylko admin) */
export function ArenaStatsDialog() {
  const { arenaCard } = useGame();
  const [data, setData] = useState<ArenaCardStats | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    setError('');
    if (arenaCard) api<ArenaCardStats>(`/api/arena/card/${encodeURIComponent(arenaCard)}`).then(setData, e => setError(e.message));
  }, [arenaCard]);
  if (!arenaCard) return null;
  const close = () => { S.arenaCard = null; touch(); };
  const p = person(arenaCard);
  return (
    <Modal title={`Statystyki areny: ${p?.name ?? ''}`} onClose={close}>
      {error && <p className="ars-err">{error}</p>}
      {!data && !error && <p className="ars-muted">Wczytywanie</p>}
      {data && (
        <div className="ars">
          <dl className="ars-grid">
            <div><dt>Atak</dt><dd>{data.atk}</dd></div>
            <div><dt>HP</dt><dd>{data.hp}</dd></div>
            <div><dt>Zasięg</dt><dd>{rangeText(data.range)}</dd></div>
            <div><dt>Punkty</dt><dd>{data.points}</dd></div>
            <div><dt>Klasa</dt><dd>{data.class ?? '-'}</dd></div>
            <div><dt>Specjalizacja</dt><dd>{data.spec ?? '-'}</dd></div>
          </dl>
          <p className="ars-muted">Punkty to też koszt wystawienia karty w meczu (w pieniądzach meczu). Zasięg 1 = rząd rywala tuż naprzeciw pierwszej linii.</p>
          <h3>Umiejętności</h3>
          <ul className="ars-abs">
            {data.abilities.map((a, i) => (
              <li key={i}><b>{a.name}</b> <span className="ars-kind">{KIND_NAMES[a.kind] ?? a.kind}</span><br />{abilityText(a, data.atk, S.cfg.arena?.specials)}</li>
            ))}
          </ul>
          {data.traits && (
            <>
              <h3>Ukryte cechy (tylko admin)</h3>
              {data.traits.length ? <ul className="ars-abs">{data.traits.map(t => <li key={t.trait}>{t.trait}: <b>{t.value}</b></li>)}</ul> : <p className="ars-muted">Brak</p>}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
