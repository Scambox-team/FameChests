import { useEffect, useState } from 'react';
import { Check, Crown, Flame } from 'lucide-react';
import { api } from '../../api/client';
import { confetti, GOLDS } from '../../fx/effects';
import { plural } from '../../game/rules';
import { refreshBadges } from '../../game/session';
import { S, touch } from '../../game/store';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import { moneyChestHTML, openMoneyChest } from './moneyChest';
import styles from './DailyDialog.module.css';

const range = (m: any) => `${(m.min / 1000).toLocaleString('pl-PL')}k–${(m.max / 1000).toLocaleString('pl-PL')}k gr`;

export function DailyDialog({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/daily').then(setD).catch(e => { toast(e.message, true); onClose(); });
  }, []);

  if (!d) return null;
  const D = S.cfg.moneyChests.daily, M = S.cfg.moneyChests.mega, kind = d.todayKind, owned = S.chests[`money_${kind}`] || 0;
  const days = (n: number) => `${n} ${plural(n, 'dzień', 'dni', 'dni')}`;

  const claim = async () => {
    setBusy(true);
    Sound.unlock();
    try {
      const res = await api('/api/daily/claim', {});
      S.chests = res.chests;
      S.dailyClaimable = false;
      touch();
      refreshBadges();
      if (res.kind === 'mega') { Sound.gold(); setTimeout(() => confetti(GOLDS, 120), 200); } else Sound.win();
      setD(res.daily);
      setClaimed(res.kind);
    } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const openNow = (k: string) => { onClose(); openMoneyChest(k); };

  return (
    <Modal title="Codzienna skrzynka" onClose={onClose}>
      <p className="muted">Każdego dnia odbierz {D.name} z kasą: {range(D)}. Odbieraj ją {S.cfg.dailyStreak} dni z rzędu, a w {S.cfg.dailyStreak}. dniu dostaniesz {M.name}: {range(M)}. Pominięty dzień zaczyna serię od nowa.</p>
      <div className={styles.week}>
        {d.days.map((w: any) => (
          <div key={w.day} className={`${styles.day}${w.today ? ` ${styles.today}` : ''}${w.claimed ? ` ${styles.done}` : ''}${w.kind === 'mega' ? ` ${styles.mega}` : ''}`}>
            <span className="small">Dzień {w.day}</span>
            {w.claimed ? <Check size={20} aria-label="odebrano" /> : w.kind === 'mega' ? <Crown size={20} aria-hidden="true" /> : <span className={styles.chest} dangerouslySetInnerHTML={{ __html: moneyChestHTML(w.kind) }} />}
          </div>
        ))}
      </div>
      {d.streak > 1 && <p className={styles.streak}><Flame size={16} aria-hidden="true" />Seria: {days(d.streak)} z rzędu</p>}
      {claimed
        ? <p><b>{S.cfg.moneyChests[claimed].name}</b> trafiła do ekwipunku. Możesz ją otworzyć teraz albo później.</p>
        : <p className="muted">{d.claimable
          ? (kind === 'mega' ? 'Dziś MEGA skrzynka.' : `Do MEGA skrzynki: ${days(d.daysToJackpot)} logowania z rzędu.`)
          : `Dzisiejsza skrzynka odebrana. ${d.daysToJackpot === 0 ? 'Wróć jutro, zaczniesz nową serię.' : `MEGA za ${days(d.daysToJackpot)}, wróć jutro, żeby nie przerwać serii.`}`}</p>}
      <div className={styles.acts}>
        {d.claimable && <Button kind="hue" big disabled={busy} onClick={claim}>Odbierz {kind === 'mega' ? 'MEGA skrzynkę' : 'skrzynkę'}</Button>}
        {!d.claimable && owned > 0 && <Button kind="hue" big onClick={() => openNow(kind)}>Otwórz teraz{owned > 1 ? ` (${owned})` : ''}</Button>}
        {!d.claimable && !owned && (S.chests.money_daily || S.chests.money_mega) > 0 && <Button kind="hue" onClick={() => openNow(S.chests.money_mega ? 'mega' : 'daily')}>Otwórz skrzynkę z ekwipunku</Button>}
        <Button onClick={onClose}>{claimed ? 'Później' : 'Zamknij'}</Button>
      </div>
    </Modal>
  );
}
