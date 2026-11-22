import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Gift, Lock, TreePine } from 'lucide-react';
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
          <div className={s.deco} aria-hidden="true" />
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
      <div className={s.calendar}>
        {(event.advent || []).map(d => (
          <div key={d.day} className={`${s.door} ${d.claimed ? s.opened : ''} ${d.today ? s.today : ''} ${d.claimable && d.past ? s.missed : ''}`}>
            <b className={s.num}>{d.day}</b>
            {d.claimed
              ? <span className={s.rewards}>{(d.rewards || []).map(r => r.text).join(', ') || '-'}</span>
              : d.claimable
                ? <Button kind="hue" disabled={busy} onClick={() => claim(d.day)}>Otwórz{d.past && <small> (zaległe)</small>}</Button>
                : <Lock size={16} className={s.lock} aria-label="jeszcze zamknięte" />}
          </div>
        ))}
      </div>
    </Modal>
  );
}
