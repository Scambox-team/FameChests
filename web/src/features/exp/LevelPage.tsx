import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, ChevronsUp, Gift, Lock, Package, Sparkles } from 'lucide-react';
import { api } from '../../api/client';
import { useGame } from '../../game/store';
import { fmtNum } from '../../lib/format';
import { PageHero } from '../../ui/PageHero';
import { Button } from '../../ui/Button';
import { Tabs } from '../../ui/Field';
import { serviceBadgeSvg } from './badge';
import { openChoices, type Badge } from './exp';
import s from './LevelPage.module.css';

// Strona „Poziom” (server/src/routes/exp.rs, GET /api/exp): postęp, odznaki za służbę, skąd EXP i lista wszystkich leveli z nagrodami.
// Nie ma jej w menu: wchodzi się z paska EXP u góry albo z profilu.
interface Reward { text: string }
interface LevelRow { level: number; need: number; total: number; small: Reward[]; special: Reward[]; claimed: boolean; paid: boolean; big: boolean }
interface Source { key: string; group: string; name: string; exp: number; cap: number }
type Filter = 'all' | 'big' | 'special';

/** Odznaka jako SVG z kodu (badge.ts); `tier` 1-13 */
export function ServiceBadge({ year, tier = 1, className }: { year: number; tier?: number; className?: string }) {
  const html = useMemo(() => serviceBadgeSvg(year, tier), [year, tier]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function LevelPage() {
  const g = useGame();
  const e = g.exp;
  const [filter, setFilter] = useState<Filter>('all');
  const { data, error } = useQuery({
    queryKey: ['exp-page', e?.level ?? 0, e?.cycle ?? 0, e?.unseen ?? 0],
    queryFn: () => api<{ levels: LevelRow[]; sources: Source[]; badges: Badge[]; badgeTiers: string[] }>('/api/exp'),
  });
  const next = useRef<HTMLLIElement>(null);
  useEffect(() => { document.title = 'Poziom · ScamBox'; }, []);

  const groups = useMemo(() => {
    const out = new Map<string, Source[]>();
    for (const x of data?.sources ?? []) out.set(x.group, [...(out.get(x.group) ?? []), x]);
    return [...out];
  }, [data]);

  if (error) return <p className="muted">{(error as Error).message}</p>;
  if (!data || !e) return <p className="muted">Ładowanie</p>;
  const pct = e.max ? 100 : e.need ? Math.min(100, (e.into / e.need) * 100) : 0;
  const rows = data.levels.filter(l => filter === 'all' || (filter === 'big' && l.big) || (filter === 'special' && l.special.length > 0));
  const nextLevel = e.max ? null : e.level + 1;
  const withSpecial = data.levels.filter(l => l.special.length > 0).length;
  const best = e.badge;

  return (
    <>
      <PageHero icon={ChevronsUp} title="Poziom konta" lead="Za otwieranie skrzynek, gry, kasyno, rynek i questy dostajesz EXP. Każdy nowy level to nagroda, a co 10. level - duża (wybierasz 2 z 4). Po levelu 100 dostajesz odznakę za służbę i zaczynasz od nowa."
        stats={[['Level', `${e.level} / ${e.maxLevel}`], ['EXP razem', fmtNum(e.exp)], ['Do następnego', e.max ? 'maksimum' : `${fmtNum(e.need - e.into)} EXP`], ...(e.cycle > 0 ? [['Ukończone cykle', String(e.cycle)] as [string, string]] : [])]} />

      {e.choices > 0 && (
        <section className={`panel ${s.pending}`}>
          <Gift size={22} aria-hidden="true" />
          <div><b>{e.choices === 1 ? 'Masz dużą nagrodę do wybrania' : `Masz duże nagrody do wybrania (${e.choices})`}</b> <span className="muted">Wybierz 2 z 4, reszta przepada.</span></div>
          <Button kind="hue" onClick={openChoices}>Wybierz nagrodę</Button>
        </section>
      )}

      <section className={`panel ${s.progress}`} aria-label="Postęp do następnego levelu">
        <div className={s.headRow}>
          <b className={s.bigNum}>Level {e.level}</b>
          <span className="muted">{e.max ? 'Maksymalny level' : `${fmtNum(e.into)} / ${fmtNum(e.need)} EXP do levelu ${e.level + 1}`}</span>
          {nextLevel && <button type="button" className={s.jump} onClick={() => next.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Pokaż nagrodę za level {nextLevel}</button>}
        </div>
        <div className={s.meter} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${pct}%` }} /></div>
      </section>

      <section className={`panel ${s.service}`} aria-label="Odznaka za służbę">
        {best
          ? <ServiceBadge year={best.year} tier={best.tier} className={s.serviceArt} />
          : <span className={`${s.serviceArt} ${s.serviceOff}`} aria-hidden="true"><Award size={54} strokeWidth={1.2} /></span>}
        <div>
          <h3>{best ? `Odznaka za służbę: ${best.name}, rok ${best.year}` : 'Odznaka za służbę'}</h3>
          <p className="muted">{best
            ? 'Twoja najwyższa odznaka zostaje na profilu na zawsze. Jeśli w jednym roku dojdziesz do levelu 100 jeszcze raz, odznaka z tego roku wskoczy na wyższy poziom.'
            : 'Dojdź do levelu 100, a dostaniesz odznakę z rokiem, w którym to zrobiłeś, i zaczniesz od początku. Kolejne dojścia do 100 w tym samym roku podnoszą jej poziom. Odznaka pokaże się na profilu i w rankingu.'}</p>
          <div className={s.ladder} role="list" aria-label="Poziomy odznaki">
            {data.badgeTiers.map((name, i) => {
              const got = (best?.tier ?? 0) >= i + 1;
              return <span key={name} role="listitem" className={`${s.tier}${got ? ` ${s.tierOn}` : ''}`} title={`${i + 1}. ${name}${i === 0 ? ' (1 raz w roku)' : ` (${i + 1} razy w roku)`}`}><ServiceBadge year={best?.year ?? new Date().getFullYear()} tier={i + 1} className={s.tierArt} /><small>{name}</small></span>;
            })}
          </div>
          {data.badges.length > 1 && <p className="muted small">{`Wszystkie lata: ${data.badges.map(b => `${b.year} (${b.name})`).join(', ')}.`}</p>}
        </div>
      </section>

      <details className={`panel ${s.sources}`}>
        <summary><Sparkles size={16} aria-hidden="true" /> Skąd bierze się EXP</summary>
        <p className="muted small">Każde źródło ma dzienny próg EXP: po jego przekroczeniu za to samo zdarzenie dostajesz coraz mniej, aż do 1 EXP, więc poziomu nie da się nabić jedną czynnością. EXP dają tylko zdarzenia, które coś kosztowały albo się skończyły (np. gra do końca).</p>
        {groups.map(([name, list]) => (
          <div key={name} className={s.group}>
            <h4>{name}</h4>
            <ul>{list.map(x => <li key={x.key}><span>{x.name}</span><b>+{fmtNum(x.exp)} EXP</b>{x.cap > 0 && <small className="muted">pełny EXP do {fmtNum(x.cap)} na dobę</small>}</li>)}</ul>
          </div>
        ))}
      </details>

      <div className={s.tools}>
        <Tabs label="Pokaż levele" value={filter} onChange={setFilter} items={[
          { id: 'all', label: 'Wszystkie' }, { id: 'big', label: 'Duże nagrody' }, { id: 'special', label: 'Specjalne', count: withSpecial }]} />
      </div>
      <ol className={s.levels}>
        {rows.map(l => {
          const isNext = l.level === nextLevel;
          const state = l.claimed ? (l.paid ? 'Odebrany' : 'Zaliczony') : isNext ? 'Następny' : 'Zablokowany';
          return (
            <li key={l.level} ref={isNext ? next : undefined} className={`${s.lvl}${l.claimed ? ` ${s.done}` : ''}${isNext ? ` ${s.next}` : ''}${l.big ? ` ${s.bigLvl}` : ''}`}>
              <span className={s.num}>{l.level}</span>
              <div className={s.info}>
                <b>Level {l.level}{l.big && l.level > 1 && <em> · duża nagroda</em>}</b>
                <small className="muted">{l.level === 1 ? 'Początek konta' : `od ${fmtNum(l.total)} EXP`}</small>
              </div>
              <div className={s.rewards}>
                {l.small.map((r, i) => <span key={`s${i}`} className={s.chip}><Gift size={12} aria-hidden="true" /> {r.text}</span>)}
                {l.special.map((r, i) => <span key={`p${i}`} className={`${s.chip} ${s.special}`}><Sparkles size={12} aria-hidden="true" /> Specjalna: {r.text}</span>)}
                {l.big && l.level > 1 && <span className={`${s.chip} ${s.special}`}><Package size={12} aria-hidden="true" /> Do wyboru 2 z 4: skrzynka z pieniędzmi, karty Mityczne lub lepsze, a czasem naklejki na karty</span>}
                {l.level === 100 && <span className={`${s.chip} ${s.special}`}><Award size={12} aria-hidden="true" /> Odznaka za służbę i nowy cykl</span>}
                {l.level === 1 && <span className="muted small">bez nagrody - tu zaczynasz</span>}
              </div>
              <span className={s.state}>{!l.claimed && !isNext && <Lock size={12} aria-hidden="true" />} {state}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
