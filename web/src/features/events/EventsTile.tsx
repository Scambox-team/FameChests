import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Gift, Lock, Star, TreePine } from 'lucide-react';
import { api } from '../../api/client';
import { applyState, syncInventory } from '../../game/session';
import { S, touch } from '../../game/store';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import { ChristmasDialog } from './Christmas';
import s from './events.module.css';

// Eventy na stronie startowej (server/src/events.rs): trwające i nadchodzące, z opisem i terminem; kalendarz adwentowy
// w okienku - dziś otwiera się jedno okienko, nagroda trafia od razu do ekwipunku.
type Reward = { type: string; text: string };
type Day = { day: number; claimed: boolean; today: boolean; past: boolean; claimable: boolean; rewards: Reward[] | null };
type Christmas = { available: boolean; adminOnly?: boolean; running: boolean };
interface GameEvent { id: string; name: string; desc: string; start: string; end: string; active: boolean; drops: { name: string; chance: number }[]; advent: Day[] | null; christmas?: Christmas }

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });

const LIGHT_COLORS = ['#ff3b3b', '#ffd60a', '#30d158', '#0a84ff', '#ff9f0a', '#bf5af2'];
/** Sznur kolorowych lampek (ozdoba eventu Święta): n żarówek rozłożonych równo, każda mruga w swoim rytmie */
const bulbs = (n: number, cls: string) => Array.from({ length: n }, (_, k) => (
  <i key={k} className={cls} style={{ left: `${(k + .5) / n * 100}%`, ['--c' as any]: LIGHT_COLORS[k % LIGHT_COLORS.length], ['--d' as any]: `-${(k * .37) % 1.8}s` }} />
));
const BAUBLES = [['#e8283a', 6, 0], ['#ffd60a', 20, -.8], ['#0a84ff', 2, -1.6], ['#30d158', 14, -2.2]] as const;

export function EventsTile() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['events'], queryFn: () => api<{ events: GameEvent[] }>('/api/events'), staleTime: 60_000 });
  const [advent, setAdvent] = useState<string | null>(null);
  const [tree, setTree] = useState(false);
  const events = data?.events || [];
  if (!events.length) return null;
  const open = events.find(e => e.id === advent);
  return (
    <>
      {events.map(e => (
        <section key={e.id} className={`${s.tile} ${s[`ev_${e.id}`] || ''}`} aria-label={`Event: ${e.name}`}>
          <div className={s.deco} aria-hidden="true">
            {e.id === 'swieta' && <>
              <div className={s.lights}>{bulbs(30, '')}</div>
              <div className={s.baubles}>{BAUBLES.map(([c, len, d], k) => <i key={k} style={{ ['--c' as any]: c, ['--len' as any]: `${len}px`, ['--d' as any]: `${d}s` }} />)}</div>
            </>}
          </div>
          <div className={s.copy}>
            <span className={s.when}><CalendarDays size={15} aria-hidden="true" /> {e.active ? `Trwa do ${fmtDate(e.end)}` : `Od ${fmtDate(e.start)} do ${fmtDate(e.end)}`}</span>
            <h2 className={s.name}>{e.name}</h2>
            {e.desc && <p className={s.lead}>{e.desc}</p>}
            {e.drops.length > 0 && <p className={s.drops}>{e.drops.map(d => `${d.name}: szansa ${+(d.chance * 100).toFixed(2)}% z każdej skrzynki`).join(' · ')}</p>}
          </div>
          {e.christmas?.available && e.active && (
            <p className={s.running}><b>Event trwa!</b> Otwieraj okienka kalendarza adwentowego i dekoruj wspólną choinkę.{e.christmas.adminOnly && <span className={s.adminTag}>Tylko dla adminów (dla graczy wyłączone)</span>}</p>
          )}
          {(e.advent || e.christmas?.available) && (
            <div className={s.actions}>
              {e.advent && (
                <Button kind="hue" onClick={() => { Sound.click(); setAdvent(e.id); }}>
                  <Gift size={16} aria-hidden="true" /> {e.advent.some(d => d.claimable) ? 'Otwórz okienko' : 'Kalendarz adwentowy'}
                </Button>
              )}
              {e.christmas?.available && (
                <Button onClick={() => { Sound.click(); setTree(true); }}><TreePine size={16} aria-hidden="true" /> Choinka</Button>
              )}
            </div>
          )}
        </section>
      ))}
      {open && <AdventCalendar event={open} onClose={() => setAdvent(null)} />}
      {tree && <ChristmasDialog onClose={() => { setTree(false); qc.invalidateQueries({ queryKey: ['events'] }); }} />}
    </>
  );
}

function AdventCalendar({ event, onClose }: { event: GameEvent; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [won, setWon] = useState<Reward[] | null>(null);
  const claim = async (day: number) => {
    setBusy(true);
    try {
      const r = await api<{ rewards: Reward[]; state: any; chests: Record<string, number> }>(`/api/events/${event.id}/advent`, { day });
      applyState(r.state);
      S.chests = r.chests;
      touch();
      Sound.coin(2);
      setWon(r.rewards);
      await syncInventory(null, true);
      qc.invalidateQueries({ queryKey: ['events'] });
    } catch (e: any) { Sound.error(); toast(e.message, true); }
    setBusy(false);
  };
  return (
    <Modal title={`${event.name}: kalendarz adwentowy`} onClose={onClose} wide>
      <p className="muted">Codziennie od {fmtDate(event.start)} otwórz jedno okienko. Jeśli któregoś dnia zapomnisz, zaległe okienka możesz otworzyć później.</p>
      {won && <p className={s.won}>W okienku: <b>{won.map(r => r.text).join(', ') || 'nic'}</b></p>}
      <div className={s.calWrap}>
        <div className={s.calLights} aria-hidden="true">{bulbs(24, '')}</div>
        <h3 className={s.calTitle}>Wesołych Świąt!</h3>
        <div className={s.calendar}>
          {(event.advent || []).map((d, k, all) => {
            const last = k === all.length - 1 && d.day === 24;
            const cls = `${s.door} ${s[`c${k % 6}`] || ''} ${d.claimed ? s.opened : ''} ${d.today ? s.today : ''} ${d.claimable && d.past ? s.missed : ''} ${!d.claimed && !d.claimable ? s.locked : ''} ${d.claimable ? s.claimable : ''} ${last ? s.wigilia : ''}`;
            const label = d.claimed ? `Okienko ${d.day}, otwarte` : d.claimable ? `Otwórz okienko ${d.day}${d.past ? ' (zaległe)' : ''}` : `Okienko ${d.day}, jeszcze zamknięte`;
            const face = (
              <>
                <span className={s.box} aria-hidden="true">{last && <Star size={18} className={s.star} fill="currentColor" />}</span>
                <b className={s.num} aria-hidden="true">{d.day}</b>
                {d.claimable && <span className={s.tag}>{d.today ? 'Otwórz!' : <>Otwórz<small> (zaległe)</small></>}</span>}
                {!d.claimed && !d.claimable && <Lock size={15} className={s.lock} aria-hidden="true" />}
                {d.claimed && <span className={s.inside}><b>{d.day}</b><span className={s.rewards}>{(d.rewards || []).map(r => r.text).join(', ') || '-'}</span></span>}
              </>
            );
            return d.claimable
              ? <button key={d.day} type="button" className={cls} disabled={busy} aria-label={label} onClick={() => claim(d.day)}>{face}</button>
              : <div key={d.day} className={cls} role="img" aria-label={label}>{face}</div>;
          })}
        </div>
      </div>
    </Modal>
  );
}
