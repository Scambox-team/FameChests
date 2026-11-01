import { ArrowLeftRight, Coins, TriangleAlert } from 'lucide-react';
import { api } from '../../api/client';
import { PickTile } from '../../cards/PickTile';
import { confetti, openViewer } from '../../fx/effects';
import { withReveal } from '../../game/reveal';
import { applyState, refreshBadges, refreshConfig } from '../../game/session';
import { S } from '../../game/store';
import { fmt } from '../../lib/format';
import { timeAgo } from '../../lib/time';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { UserLink } from '../../ui/UserLink';
import s from './social.module.css';

const STATUS: Record<string, string> = { accepted: 'przyjęta', declined: 'odrzucona', cancelled: 'wycofana' };

function Side({ title, lines, money }: { title: string; lines: any[]; money: number }) {
  const value = lines.reduce((a, l) => a + l.value * l.count, 0) + money;
  return (
    <div>
      <div className={s.sideTitle}>{title} <span className="muted">· {fmt(value)}</span></div>
      <div className={s.lines}>
        {lines.map((l, i) => {
          const reveal = l.reveal ? { map: { [l.person]: l.reveal }, imgq: `owner=${encodeURIComponent(l.owner || '')}` } : undefined;
          return <PickTile key={i} item={l} reveal={reveal} extra={l.count > 1 ? <span className="pc">×{l.count}</span> : undefined} onClick={() => withReveal(reveal, () => openViewer(l.person, l.variant))} />;
        })}
        {money > 0 && <div className={s.money}><Coins size={18} aria-hidden="true" /><b>{fmt(money)}</b></div>}
        {!lines.length && !money && <span className="muted small">nic</span>}
      </div>
    </div>
  );
}

function Trade({ t, kind, done }: { t: any; kind: 'incoming' | 'outgoing' | 'history'; done: () => void }) {
  const other = t.mine ? t.to : t.from;
  const run = async (fn: () => Promise<any>, ok?: string, after?: (res: any) => Promise<void>) => {
    try {
      const res = await fn();
      if (ok) toast(ok);
      await after?.(res);
    } catch (e: any) { Sound.error(); toast(e.message, true); }
    refreshBadges();
    done();
  };
  const accept = () => {
    if (!confirm('Przyjąć tę wymianę? Karty zostaną od razu wymienione.')) return;
    run(() => api(`/api/trades/${t.id}/accept`, {}), undefined, async res => {
      S.items = res.items;
      S.showcase = res.showcase || [];
      applyState(res.state);
      await refreshConfig();   // tajne karty z wymiany są teraz odkryte
      Sound.win();
      confetti(['#3ddc84', '#ffcf3f', '#4b8bff', '#fff'], 120);
      toast('Wymiana zakończona. Karty są w twoim ekwipunku.');
    });
  };
  return (
    <article className={`${s.trade}${kind === 'history' ? ` ${s.old}` : ''}`}>
      <div className={s.tradeHead}><UserLink user={other} />
        <span className="muted small">{kind === 'incoming' ? 'proponuje ci wymianę' : kind === 'outgoing' ? 'czeka na odpowiedź' : ''}</span>
        <span className={s.time}>{timeAgo(kind === 'history' ? t.updated : t.created)}</span></div>
      {t.message && <div className={s.quote}>„{t.message}”</div>}
      <div className={s.tradeBody}>
        <Side title={t.mine ? 'Dajesz' : `${other.username} daje`} lines={t.give} money={t.moneyGive} />
        <ArrowLeftRight className={s.arrow} size={22} aria-hidden="true" />
        <Side title={t.mine ? `Chcesz od ${other.username}` : 'Chce od ciebie'} lines={t.want} money={t.moneyWant} />
      </div>
      {t.problem && <div className={s.problem}><TriangleAlert size={15} aria-hidden="true" /> {t.problem}</div>}
      <div className={s.tradeBtns}>
        {kind === 'incoming' && <>
          <Button kind="hue" disabled={!!t.problem} onClick={accept}>Przyjmij</Button>
          <Button onClick={() => run(() => api(`/api/trades/${t.id}/decline`, {}), 'Odrzucono ofertę')}>Odrzuć</Button>
        </>}
        {kind === 'outgoing' && <Button onClick={() => run(() => api(`/api/trades/${t.id}/cancel`, {}), 'Wycofano ofertę')}>Wycofaj</Button>}
        {kind === 'history' && <span className="muted small">{STATUS[t.status] || t.status}</span>}
      </div>
    </article>
  );
}

export function TradesPanel({ tr, done }: { tr: any; done: () => void }) {
  return (
    <section className={s.panel}>
      <h2>Wymiany</h2>
      <p className="muted small">Wymianę zaproponujesz przyciskiem przy znajomym albo na jego profilu.</p>
      {tr.incoming.length > 0 && <div className={s.section}><h3>Oferty dla ciebie ({tr.incoming.length})</h3>{tr.incoming.map((t: any) => <Trade key={t.id} t={t} kind="incoming" done={done} />)}</div>}
      {tr.outgoing.length > 0 && <div className={s.section}><h3>Twoje oferty</h3>{tr.outgoing.map((t: any) => <Trade key={t.id} t={t} kind="outgoing" done={done} />)}</div>}
      {!tr.incoming.length && !tr.outgoing.length && <p className="muted small">Brak aktywnych ofert.</p>}
      {tr.history.length > 0 && <details className={s.section}><summary>Historia ({tr.history.length})</summary>{tr.history.map((t: any) => <Trade key={t.id} t={t} kind="history" done={done} />)}</details>}
    </section>
  );
}
