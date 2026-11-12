import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, ExternalLink, Flag, Lightbulb, Lock, Timer, Trophy } from 'lucide-react';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { confetti } from '../../fx/effects';
import { person, variantName } from '../../game/rules';
import { syncInventory } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import { questTime, useCountdown } from './QuestTile';
import s from './home.module.css';
import c from './ctf.module.css';

const REWARD = 'digital';
const LIMIT_NOTE = 'Przekroczono dzienny limit zadań CTF. Do jutra nie odbierzesz już karty ani pieniędzy z tego questa.';

/** Stan questa CTF z /api/me; wygrana pokazuje się raz */
export function noteCtf(q: any) {
  if (JSON.stringify(S.ctf ?? null) !== JSON.stringify(q ?? null)) { S.ctf = q || null; touch(); }
  if (q?.mine) celebrate(q, false);
}

function celebrate(q: any, now: boolean) {
  const key = `ctfWon:${q.key}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch { if (!now) return; }
  toast(`Flaga zdobyta: ${person(q.person).name} w wariancie ${variantName(REWARD)} i +${fmt(q.money)} są twoje`);
  Sound.win();
  confetti(['#3dff7a', '#b6ffcf', '#0b3d1c'], 160);
}

function Level({ n }: { n: number }) {
  const name = n >= 3 ? 'trudne' : n === 2 ? 'średnie' : 'łatwe';
  return <span className={c.level} aria-label={`Poziom: ${name}`}>{[1, 2, 3].map(i => <i key={i} className={i <= n ? c.on : ''} />)}<span>{name}</span></span>;
}

type Phase = 'live' | 'breach' | 'owned';

/** Quest CTF: stary monitor CRT w serwerowni. Na ekranie terminal z zadaniem i karta-nagroda w wariancie Cyfrowa;
 *  po zdobyciu flagi ekran się sypie i zostaje napis FLAGA ZDOBYTA. */
export function CtfSlide({ onOpen }: { onOpen: () => void }) {
  const { ctf: q } = useGame();
  const done = !!q?.done;
  const [phase, setPhase] = useState<Phase>(done ? 'owned' : 'live');
  const was = useRef(done);
  const left = useCountdown(q?.nextAt);
  const hintIn = useCountdown(q?.nextHintAt ?? undefined);

  useEffect(() => {
    if (done === was.current) return;
    was.current = done;
    if (!done) { setPhase('live'); return; }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setPhase('owned'); return; }
    setPhase('breach');
    const t = setTimeout(() => setPhase('owned'), 1600);
    return () => clearTimeout(t);
  }, [done]);

  if (!q) return null;
  const prize = q.person ? person(q.person) : null;
  return (
    <>
      <div className={`${c.rig} ${c[phase]}`}>
        <span className={c.leds} aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
        <button type="button" className={c.monitor} onClick={onOpen} aria-label={`Otwórz zadanie CTF: ${q.title}`}>
          <span className={c.screen}>
            {phase !== 'owned' ? (
              <>
                <span className={c.term} aria-hidden="true">
                  <span>root@scambox:~$ ./ctf</span>
                  <span>[*] typ: {String(q.category).toLowerCase()}</span>
                  <span>[*] lvl: {'■'.repeat(q.level)}{'□'.repeat(Math.max(0, 3 - q.level))}</span>
                  <span>{'[?] SB{????}'}</span>
                  <span>[i] hint {q.hintsOpen}/{q.hintsTotal}<b className={c.cursor} /></span>
                </span>
                {q.person && <span className={c.prize}><Card person={q.person} variant={REWARD} /></span>}
              </>
            ) : (
              <span className={c.owned}>
                <b>FLAGA ZDOBYTA</b>
                <span>{q.mine ? 'przez ciebie' : `przez ${q.winner || '???'}`}</span>
                <small>nowe zadanie za {left}</small>
              </span>
            )}
            <span className={c.scan} aria-hidden="true" />
          </span>
          <span className={c.brand} aria-hidden="true">SCAMTRON 14"</span>
          <span className={c.power} aria-hidden="true" />
        </button>
        {phase === 'live' && <span className={c.note} aria-hidden="true">hint<br />{q.hintsOpen}/{q.hintsTotal}</span>}
        <span className={c.desk} aria-hidden="true" />
      </div>
      <div className={s.copy}>
        <span className={s.kicker}><Flag size={14} aria-hidden="true" />Quest · Capture the flag</span>
        {!done ? (
          <>
            <h2 className={s.name}>{q.title} <span className={c.cat}>{q.category}</span></h2>
            <Level n={q.level} />
            <p className={s.lead}>{q.reward
              ? `Znajdź ukrytą flagę i wpisz ją jako pierwszy. Nagroda: ${prize?.name ?? '?'} w wariancie ${variantName(REWARD)} i ${fmt(q.reward)}.`
              : `Znajdź ukrytą flagę i wpisz ją jako pierwszy. Nagroda: ${prize?.name ?? '?'} w wariancie ${variantName(REWARD)}.`}</p>
            {q.limitReached && <p className={s.where}>{LIMIT_NOTE}</p>}
            <button type="button" className={c.go} onClick={onOpen}>Rozwiąż zadanie</button>
            <span className={s.timer}><Lightbulb size={15} aria-hidden="true" />Podpowiedzi: <b>{q.hintsOpen}/{q.hintsTotal}</b>{q.nextHintAt ? <> · następna za <b>{hintIn}</b></> : null}</span>
          </>
        ) : q.mine ? (
          <p className={`${s.lead} ${s.won}`}><Trophy size={16} aria-hidden="true" />{`Flaga jest twoja: ${prize?.name ?? '?'} w wariancie ${variantName(REWARD)} i ${fmt(q.money)}.`}</p>
        ) : (
          <p className={s.lead}>{`Ktoś był szybszy. Flagę zdobył ${q.winner || '?'}.`} <button type="button" className={c.link} onClick={onOpen}>Zobacz rozwiązanie</button></p>
        )}
        {done && q.wonAt && <span className={s.timer}><CheckCircle2 size={15} aria-hidden="true" />Wykonano o <b>{questTime(q.wonAt)}</b></span>}
        <span className={s.timer}><Timer size={15} aria-hidden="true" />{done ? 'Nowy quest za' : 'Quest kończy się za'} <b>{left}</b></span>
      </div>
    </>
  );
}

/** Okno zadania: opis, adres strony albo dane, podpowiedzi i pole na flagę */
export function CtfDialog({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [flag, setFlag] = useState('');
  const [busy, setBusy] = useState(false);
  const hintIn = useCountdown(d?.nextHintAt ?? undefined);
  const { ctf } = useGame();

  const load = () => api('/api/quests/ctf').then(setD, e => setErr(e.message));
  // nowa podpowiedź albo koniec questa (z /api/me) - wczytaj zadanie od nowa
  useEffect(() => { load(); }, [ctf?.key, ctf?.hintsOpen, ctf?.done]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!flag.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api('/api/quests/ctf', { flag });
      const q = { ...S.ctf, done: true, mine: true, money: r.money, wonAt: Date.now() / 1000 };
      S.ctf = q; touch();
      celebrate(q, true);
      syncInventory(null, true);
      setFlag('');
      load();
    } catch (ex: any) {
      toast(ex.message, true);
      Sound.error();
      load();
    } finally { setBusy(false); }
  }

  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('Skopiowano'), () => {});
  return (
    <Modal title={d?.title ? `CTF: ${d.title}` : 'Capture the flag'} onClose={onClose} wide>
      <div className={c.dlg}>
        {!d ? <p className={c.muted}>{err || 'Łączenie z serwerem...'}</p> : (
          <>
            <div className={c.meta}><span className={c.cat}>{d.category}</span><Level n={d.level} /></div>
            <p className={c.brief}>{d.brief}</p>
            {d.url && (
              <a className={c.target} href={d.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={16} aria-hidden="true" />Otwórz stronę zadania<code>{location.host}{d.url}</code>
              </a>
            )}
            {d.data && (
              <div className={c.data}>
                <pre>{d.data}</pre>
                <button type="button" className={c.copy} onClick={() => copy(d.data)} aria-label="Kopiuj dane"><Copy size={15} aria-hidden="true" /></button>
              </div>
            )}
            <h3 className={c.h}>Podpowiedzi</h3>
            <ol className={c.hints}>
              {Array.from({ length: d.hintsTotal }, (_, i) => (
                <li key={i} className={i < d.hints.length ? c.open : c.locked}>
                  {i < d.hints.length ? d.hints[i] : (
                    <><Lock size={14} aria-hidden="true" />{i === d.hints.length && d.nextHintAt ? <>Odsłoni się za <b>{hintIn}</b></> : 'Zablokowana'}</>
                  )}
                </li>
              ))}
            </ol>
            {!d.done ? (
              <>
              {d.limitReached && <p className={c.muted}><Lock size={14} aria-hidden="true" /> {LIMIT_NOTE}</p>}
              <form className={c.form} onSubmit={submit}>
                <label className={c.prompt} htmlFor="ctfFlag">flag&gt;</label>
                <input id="ctfFlag" value={flag} onChange={e => setFlag(e.target.value)} placeholder="SB{...}" autoComplete="off" spellCheck={false} maxLength={200} />
                <button type="submit" disabled={busy || !flag.trim() || d.triesLeft <= 0 || d.limitReached}>Wyślij flagę</button>
              </form>
              </>
            ) : (
              <p className={c.solved}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {d.mine ? 'Ta flaga jest twoja.' : `Flagę zdobył ${d.winner || '?'}.`}
                {d.flag && <> Flaga: <code>{d.flag}</code></>}
              </p>
            )}
            <p className={c.muted}>
              {!d.done && <span>{`Zostało prób: ${d.triesLeft}.`} </span>}
              <span>{'Flaga wygląda tak: SB{...}, wielkość liter nie ma znaczenia. Zadanie dotyczy tylko strony zadania - nie atakuj samej gry ani innych graczy.'}</span>
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
