import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Gift, MailCheck, Share2, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { UserLink } from '../../ui/UserLink';
import s from './referral.module.css';

// Polecenia (reflinki, routes/referral.rs): mój link, nagrody, statystyki i lista poleconych z postępem aktywacji.
const skrzynek = (n: number) => n === 1 ? 'skrzynkę' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'skrzynki' : 'skrzynek';

/** Warunek nagrody słowami, np. „otworzy 5 skrzynek” */
export function activation(r: any) {
  const parts: string[] = [];
  if (r.minOpened > 0) parts.push(`otworzy ${r.minOpened} ${skrzynek(r.minOpened)}`);
  if (r.minHours > 0) parts.push(`będzie grać od ${r.minHours >= 24 ? `${Math.round(r.minHours / 24)} dni` : `${r.minHours} godz.`}`);
  return parts.join(' i ');
}

/** Status polecenia dla gracza: nagrodzone / odrzucone albo czego jeszcze brakuje */
function statusText(x: any, r: any) {
  if (x.status === 'rewarded') return 'Nagrody przyznane';
  if (x.status === 'rejected') return 'Bez nagrody';
  if (x.missing === 'email' || x.missing === 'noEmail') return 'Czeka na potwierdzenie emaila';
  if (x.missing === 'opened') return `Otworzył ${x.opened} z ${r.minOpened} skrzynek`;
  if (x.missing === 'young') return 'Konto za młode';
  return 'Czeka na sprawdzenie';
}

export function ReferralPanel() {
  const { data, refetch } = useQuery({ queryKey: ['referral'], queryFn: () => api('/api/referral') });
  const [copied, setCopied] = useState(false);
  if (!data?.enabled) return null;
  const r = data.reward, when = activation(r);
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.url); } catch { prompt('Skopiuj link:', data.url); return; }
    setCopied(true); Sound.click(); toast('Link skopiowany');
    setTimeout(() => setCopied(false), 2000);
  };
  const share = async () => {
    try { await navigator.share({ title: 'ScamBox', text: 'Zagraj ze mną w ScamBox: otwieraj skrzynki i zbieraj karty znanych osób!', url: data.url }); }
    catch { /* gracz zamknął okno udostępniania */ }
  };
  return (
    <section className={s.box}>
      <div className={s.head}>
        <Gift size={26} aria-hidden="true" />
        <div>
          <h2>Poleć znajomym</h2>
          <p className="muted small">
            Wyślij swój link. Gdy ktoś założy z niego konto, potwierdzi email{when ? ` i ${when}` : ''}, dostaniecie nagrody:
          </p>
        </div>
      </div>
      {data.referredBy && (
        <p className={s.by}>
          <UserCheck size={16} aria-hidden="true" /> Polecił Cię: <UserLink user={data.referredBy.user} />
          {data.referredBy.status === 'pending' && data.referredBy.missing !== 'ready' && (
            <span className="muted small"> ({statusText(data.referredBy, r)})</span>
          )}
        </p>
      )}
      <div className={s.rewards}>
        {r.referrer && <div><span className="muted small">Ty</span><b>{r.referrer}</b></div>}
        {r.referred && <div><span className="muted small">Twój znajomy</span><b>{r.referred}</b></div>}
      </div>
      <div className={s.link}>
        <input readOnly value={data.url} aria-label="Twój link polecający" onFocus={e => e.target.select()} />
        <Button kind="hue" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Skopiowano' : 'Kopiuj'}</Button>
        {'share' in navigator && <Button onClick={share} title="Udostępnij"><Share2 size={16} /></Button>}
      </div>
      <p className="muted small">Twój kod: <b className={s.code}>{data.code}</b></p>
      <div className={s.stats}>
        <div><b>{data.clicks}</b><span>wejść z linku</span></div>
        <div><b>{data.signups}</b><span>kont</span></div>
        <div><b>{data.pending}</b><span>w trakcie</span></div>
        <div><b>{data.rewarded}</b><span>nagród</span></div>
      </div>
      {data.list.length > 0 && (
        <ul className={s.list}>
          {data.list.map((x: any, i: number) => (
            <li key={i}>
              <span className={s.who}>
                {x.user ? <UserLink user={x.user} /> : <span className="muted">konto usunięte</span>}
                <span className="muted small">{new Date(x.created * 1000).toLocaleDateString()}</span>
              </span>
              <span className={`${s.st} ${s[x.status] ?? ''}`}>
                {statusText(x, r)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        <MailCheck size={14} aria-hidden="true" /> Najpierw polecony musi potwierdzić email, dopiero potem liczą się pozostałe warunki.
        {' '}Liczą się tylko nowe konta. Konta zakładane przez jedną osobę na kilku profilach nie dostają nagród.
        {data.monthlyCap > 0 ? ` Możesz dostać najwyżej ${data.monthlyCap} nagród w 30 dni.` : ''}
        {' '}<button type="button" className={s.refresh} onClick={() => refetch()}>Odśwież</button>
      </p>
    </section>
  );
}
