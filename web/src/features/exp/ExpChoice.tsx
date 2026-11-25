import { useEffect, useState } from 'react';
import { Check, Gift, Package, Sparkles } from 'lucide-react';
import { api } from '../../api/client';
import { applyState, syncInventory } from '../../game/session';
import { imgUrl } from '../../game/rules';
import { S, touch, useGame } from '../../game/store';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import type { ExpProgress } from './exp';
import s from './ExpChoice.module.css';

// Duża nagroda za level (domyślnie co 10.): 4 opcje wylosowane przez serwer, gracz wybiera 2, pozostałe przepadają.
// Z przeglądarki do serwera idą tylko numery wybranych opcji (server/src/routes/exp.rs `exp_choose`).
interface Reward { type: 'card' | 'chest' | 'money'; text: string; person?: string; variant?: string }
interface Option { slot: 'chest' | 'card' | 'exclusive'; exclusive: boolean; reward: Reward }
interface Pending { cycle: number; level: number; options: Option[] }

const SLOT: Record<Option['slot'], string> = { chest: 'Skrzynka z pieniędzmi', card: 'Karta Mityczna lub lepsza', exclusive: 'Ekskluzywne z leveli' };

function cardImg(r: Reward) {
  if (!r.person) return '';
  try { return imgUrl(r.person, r.variant && r.variant !== 'normal' ? r.variant : null, true); } catch { return `/img/${r.person}`; }
}

/** Okno wyboru dużej nagrody; otwiera je `openChoices` (exp.ts) albo przycisk na stronie Poziom */
export function ExpChoiceHost() {
  const g = useGame();
  return g.expChoice ? <ExpChoiceDialog onClose={() => { S.expChoice = false; touch(); }} /> : null;
}

function ExpChoiceDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Pending[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => api<{ choices: Pending[] }>('/api/exp/choices').then(d => { setList(d.choices); setPicked([]); if (!d.choices.length) onClose(); }).catch(e => { toast(e.message, true); onClose(); });
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const cur = list?.[0];
  if (!cur) return null;
  const toggle = (i: number) => setPicked(p => p.includes(i) ? p.filter(x => x !== i) : p.length < 2 ? [...p, i] : [p[1], i]);
  const confirmPick = async () => {
    if (picked.length !== 2 || busy) return;
    setBusy(true);
    try {
      const d = await api<{ rewards: Reward[]; state: any; chests: Record<string, number>; me: ExpProgress }>('/api/exp/choose', { cycle: cur.cycle, level: cur.level, picks: picked });
      S.chests = d.chests;
      S.exp = d.me;
      applyState(d.state);
      void syncInventory(null, true);
      toast(`Odebrano: ${d.rewards.map(r => r.text).join(', ')}`);
      await load();
    } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };

  return (
    <Modal title={`Duża nagroda za level ${cur.level}`} onClose={onClose} wide>
      <p className="muted">Wybierz <b>2 z 4</b> nagród. Pozostałe dwie przepadną, więc zastanów się dobrze.{list && list.length > 1 ? ` (czeka jeszcze ${list.length - 1} takich nagród)` : ''}</p>
      <div className={s.grid} role="group" aria-label="Nagrody do wyboru">
        {cur.options.map((o, i) => {
          const on = picked.includes(i);
          return (
            <button key={i} type="button" className={`${s.opt}${on ? ` ${s.on}` : ''}${o.exclusive ? ` ${s.excl}` : ''}`} aria-pressed={on} onClick={() => toggle(i)}>
              <span className={s.slot}>{o.exclusive ? <Sparkles size={13} aria-hidden="true" /> : o.reward.type === 'chest' ? <Package size={13} aria-hidden="true" /> : <Gift size={13} aria-hidden="true" />} {SLOT[o.slot]}</span>
              {o.reward.type === 'card' && <img className={s.pic} src={cardImg(o.reward)} alt="" loading="lazy" />}
              <b>{o.reward.text}</b>
              {on && <span className={s.tick} aria-hidden="true"><Check size={16} strokeWidth={3} /></span>}
            </button>
          );
        })}
      </div>
      <div className={s.btns}>
        <Button kind="hue" disabled={picked.length !== 2 || busy} onClick={confirmPick}>Wybieram te 2 nagrody</Button>
        <Button onClick={onClose}>Zdecyduję później</Button>
        <span className="muted small">Wybrano {picked.length} z 2</span>
      </div>
    </Modal>
  );
}
