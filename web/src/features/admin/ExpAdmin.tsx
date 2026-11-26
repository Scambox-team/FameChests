import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { RewardsEditor, rewardsText, type Reward, type RewardOptions } from './RewardsEditor';
import s from './ExpAdmin.module.css';

// Panel admina „EXP i levele” (server/src/routes/exp.rs, src/exp.rs): ile EXP daje które zdarzenie (i dzienny limit), krzywa leveli 1-100
// (parametry + własne wartości na level), nagrody za levele (mała, specjalna; duże domyślnie co 10. level), rozkład graczy
// i ręczne nadanie EXP / levelu. Wszystko zapisuje jeden przycisk; „Przywróć domyślne” czyści ustawienia w bazie.
interface SourceRow { key: string; group: string; name: string; exp: number; cap: number; defExp: number; defCap: number }
interface LevelRow { level: number; need: number; curveNeed: number; total: number; small: Reward[]; special: Reward[]; defaultSmall: Reward[]; defaultSpecial: Reward[]; players: number; choice: boolean }
interface ExclCard { person: string; variant: string }
interface Curve { base: number; scale: number; power: number }
interface Data extends RewardOptions {
  mult: number; backfillPct: number; curve: Curve; defaultCurve: Curve; sources: SourceRow[]; levels: LevelRow[];
  players: number; withExp: number; badges: number; maxLevel: number; backfillMaxLevel: number;
  decay: number; defaultDecay: number; exclusiveChance: number; exclusiveCards: ExclCard[]; exclusiveChests: string[]; badgeTiers: string[]; autoArrears: boolean;
}
interface Draft {
  autoArrears: boolean; mult: string; backfill: string; decay: string; chance: string; choice: number[]; exCards: ExclCard[]; exChests: string[]; curve: { base: string; scale: string; power: string };
  sources: Record<string, { exp: string; cap: string }>;
  needs: Record<number, string>;
  rewards: Record<number, { small: Reward[]; special: Reward[] }>;
}
type Filter = 'all' | 'changed' | 'special' | 'big';

const round5 = (x: number) => Math.max(5, Math.round(x / 5) * 5);
const curveNeed = (c: Curve, l: number) => round5(c.base + c.scale * Math.pow(l, c.power));
const num = (v: string, d: number) => { const x = parseFloat(v.replace(',', '.')); return Number.isFinite(x) ? x : d; };

function toDraft(d: Data): Draft {
  return {
    autoArrears: d.autoArrears, mult: String(d.mult), backfill: String(d.backfillPct), decay: String(d.decay), chance: String(Math.round(d.exclusiveChance * 100)),
    choice: d.levels.filter(l => l.choice).map(l => l.level), exCards: d.exclusiveCards, exChests: d.exclusiveChests,
    curve: { base: String(d.curve.base), scale: String(d.curve.scale), power: String(d.curve.power) },
    sources: Object.fromEntries(d.sources.map(x => [x.key, { exp: String(x.exp), cap: String(x.cap) }])),
    needs: Object.fromEntries(d.levels.filter(l => l.level < d.maxLevel && l.need !== l.curveNeed).map(l => [l.level, String(l.need)])),
    rewards: Object.fromEntries(d.levels.map(l => [l.level, { small: l.small, special: l.special }])),
  };
}

export default function ExpAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const load = () => api<Data>('/api/admin/exp').then(d => { const dr = toDraft(d); setData(d); setDraft(dr); setSaved(JSON.stringify(dr)); }).catch(e => toast(e.message, true));
  useEffect(() => { load(); }, []);

  const curve: Curve | null = draft && data ? {
    base: Math.max(1, num(draft.curve.base, data.curve.base)), scale: Math.max(0, num(draft.curve.scale, data.curve.scale)),
    power: Math.min(4, Math.max(0, num(draft.curve.power, data.curve.power))),
  } : null;

  // progi EXP policzone w przeglądarce tak samo jak na serwerze (podgląd na żywo przy zmianie krzywej)
  const rows = useMemo(() => {
    if (!data || !draft || !curve) return [];
    let total = 0;
    return data.levels.map(l => {
      const custom = parseInt(draft.needs[l.level] ?? '', 10);
      const need = l.level >= data.maxLevel ? 0 : custom > 0 ? custom : curveNeed(curve, l.level);
      const row = { ...l, need, curveNeed: l.level >= data.maxLevel ? 0 : curveNeed(curve, l.level), total, custom: custom > 0 && custom !== curveNeed(curve, l.level) };
      total += need;
      return row;
    });
  }, [data, draft, curve?.base, curve?.scale, curve?.power]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !draft || !curve) return <p className="muted">Wczytywanie…</p>;
  const dirty = JSON.stringify(draft) !== saved;
  const upd = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const t = (l: number) => rows[l - 1]?.total ?? 0;
  const maxPlayers = Math.max(1, ...data.levels.map(l => l.players));
  const defaultsOf = (l: LevelRow) => JSON.stringify({ small: l.defaultSmall, special: l.defaultSpecial });
  const changed = (l: LevelRow) => JSON.stringify({ small: draft.rewards[l.level]?.small ?? [], special: draft.rewards[l.level]?.special ?? [] }) !== defaultsOf(l) || draft.needs[l.level] !== undefined;
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(l => {
    if (filter === 'changed' && !changed(l)) return false;
    if (filter === 'special' && !(draft.rewards[l.level]?.special.length)) return false;
    if (filter === 'big' && !draft.choice.includes(l.level)) return false;
    if (!needle) return true;
    const r = draft.rewards[l.level];
    return String(l.level) === needle || rewardsText([...(r?.small ?? []), ...(r?.special ?? [])], data).toLowerCase().includes(needle);
  });

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast(done); await load(); } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const save = () => run(() => api('/api/admin/exp', {
    mult: num(draft.mult, 1), backfillPct: num(draft.backfill, 50), decay: num(draft.decay, 2),
    choiceLevels: draft.choice, exclusiveChance: Math.min(100, Math.max(0, num(draft.chance, 20))) / 100,
    exclusiveCards: draft.exCards, exclusiveChests: draft.exChests, autoArrears: draft.autoArrears,
    curve: { base: curve.base, scale: curve.scale, power: curve.power },
    needs: Object.fromEntries(Object.entries(draft.needs).filter(([, v]) => parseInt(v, 10) > 0)),
    sources: Object.fromEntries(Object.entries(draft.sources).map(([k, v]) => [k, { exp: num(v.exp, 0), cap: num(v.cap, 0) }])),
    rewards: draft.rewards,
  }), 'Zapisano ustawienia EXP i leveli');
  const reset = () => confirm('Przywrócić domyślne ustawienia EXP, krzywą i nagrody wszystkich leveli? Zapisanych zmian nie da się cofnąć.') && run(() => api('/api/admin/exp', { reset: true }), 'Przywrócono domyślne ustawienia');

  const groups = [...new Set(data.sources.map(x => x.group))];
  const setReward = (level: number, key: 'small' | 'special', v: Reward[]) =>
    upd({ rewards: { ...draft.rewards, [level]: { small: draft.rewards[level]?.small ?? [], special: draft.rewards[level]?.special ?? [], [key]: v } } });

  return (
    <section className={s.page}>
      <datalist id="expCards">{data.cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</datalist>
      <p className="muted">Gracz zbiera <b>EXP</b> za zdarzenia w grze, a z sumy EXP wynika <b>level</b> (1-{data.maxLevel}). Każdy nowy level daje nagrodę: <b>mała</b> (domyślnie grosze, co 5. level skrzynki), opcjonalną <b>specjalną</b> i
        domyślnie <b>dużą co 10. level</b> (wybór 2 z 4 opcji, patrz niżej; levele z dużą nagrodą zaznaczasz w tabeli). Nagroda jest wypłacana raz na level, nie wstecz za przeskoczone levele.
        Level 1 to start, nagrody zaczynają się od levelu 2. Po osiągnięciu levelu {data.maxLevel} gracz dostaje odznakę „za służbę w roku RRRR” (kolejne dojścia do 100 w tym samym roku podnoszą jej poziom: {data.badgeTiers.join(', ')}) i jego level wraca do 1.</p>

      <div className={`panel ${s.block}`}>
        <h3>Ustawienia ogólne</h3>
        <div className={s.fields}>
          <label>Globalny mnożnik EXP<input inputMode="decimal" value={draft.mult} onChange={e => upd({ mult: e.target.value })} /><small className="muted">1 = bez zmian, 2 = podwójny EXP (np. na event). 0 wyłącza zdobywanie EXP.</small></label>
          <label>EXP z historii starych kont (%)<input inputMode="numeric" value={draft.backfill} onChange={e => upd({ backfill: e.target.value })} /><small className="muted">Przy pierwszym wejściu stare konto dostaje ten procent EXP za to, co już zrobiło (skrzynki, osiągnięcia, kontrakty, szachy...), najwyżej do levelu {data.backfillMaxLevel}.
            Przeskoczone levele zaliczają się BEZ nagród - brakujące nagrody można wypłacić w sekcji „Zaległe nagrody za levele” niżej.</small></label>
          <label>Szybkość spadku EXP po progu<input inputMode="decimal" value={draft.decay} onChange={e => upd({ decay: e.target.value })} /><small className="muted">Po przekroczeniu dziennego progu źródła EXP za zdarzenie = EXP × (próg / zdobyte dziś)<sup>wykładnik</sup>, nie mniej niż 1. Domyślnie {data.defaultDecay}; większy wykładnik = szybszy spadek.</small></label>
        </div>
      </div>

      <div className={`panel ${s.block}`}>
        <h3>Źródła EXP</h3>
        <p className="muted small">EXP za jedno zdarzenie i dzienny PRÓG EXP z tego źródła na gracza: do progu pełny EXP, potem coraz mniej (aż do 1 EXP za zdarzenie), 0 = bez spadku. Wszystko przed mnożnikiem. EXP za grę dostaje się dopiero po jej zakończeniu, za skrzynki tylko płatne, za kasyno tylko gry ze stawką.</p>
        {groups.map(g => (
          <div key={g} className={s.group}>
            <h4>{g}</h4>
            {data.sources.filter(x => x.group === g).map(x => {
              const v = draft.sources[x.key];
              const edited = +v.exp !== x.defExp || +v.cap !== x.defCap;
              return (
                <div key={x.key} className={s.src}>
                  <span className={s.srcName}>{x.name}{edited && <em> · zmienione (domyślnie {x.defExp} EXP, próg {x.defCap || 'brak'})</em>}</span>
                  <label>EXP<input inputMode="numeric" value={v.exp} onChange={e => upd({ sources: { ...draft.sources, [x.key]: { ...v, exp: e.target.value } } })} aria-label={`${x.name}: EXP`} /></label>
                  <label>Próg na dobę<input inputMode="numeric" value={v.cap} onChange={e => upd({ sources: { ...draft.sources, [x.key]: { ...v, cap: e.target.value } } })} aria-label={`${x.name}: dzienny próg EXP`} /></label>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className={`panel ${s.block}`}>
        <h3>Krzywa leveli</h3>
        <p className="muted small">EXP na przejście z levelu L na L+1 = <b>podstawa + skala · L<sup>wykładnik</sup></b> (zaokrąglone do 5). Pojedyncze poziomy możesz nadpisać w tabeli niżej.</p>
        <div className={s.fields}>
          <label>Podstawa<input inputMode="decimal" value={draft.curve.base} onChange={e => upd({ curve: { ...draft.curve, base: e.target.value } })} /></label>
          <label>Skala<input inputMode="decimal" value={draft.curve.scale} onChange={e => upd({ curve: { ...draft.curve, scale: e.target.value } })} /></label>
          <label>Wykładnik (0-4)<input inputMode="decimal" value={draft.curve.power} onChange={e => upd({ curve: { ...draft.curve, power: e.target.value } })} /></label>
          <Button disabled={JSON.stringify(draft.curve) === JSON.stringify({ base: String(data.defaultCurve.base), scale: String(data.defaultCurve.scale), power: String(data.defaultCurve.power) })}
            onClick={() => upd({ curve: { base: String(data.defaultCurve.base), scale: String(data.defaultCurve.scale), power: String(data.defaultCurve.power) } })}>Domyślna krzywa</Button>
        </div>
        <div className={s.chips}>
          {[10, 25, 50, 75, 100].map(l => <span key={l} className={s.chip}>Level {l}: <b>{t(l).toLocaleString('pl-PL')}</b> EXP</span>)}
          <span className="muted small">Przy ok. 500 EXP na dobę: level 100 po około {Math.round(t(100) / 500 / 30 * 10) / 10} mies.</span>
        </div>
      </div>

      <div className={`panel ${s.block}`}>
        <h3>Rozkład graczy po levelach</h3>
        <p className="muted small">{data.players.toLocaleString('pl-PL')} kont, z czego {data.withExp.toLocaleString('pl-PL')} ma już zapis EXP (reszta jest na levelu 1 i dostanie EXP z historii przy pierwszym wejściu). Odznak za służbę: {data.badges}.</p>
        <div className={s.chart} role="img" aria-label="Liczba graczy na poszczególnych levelach">
          {data.levels.map(l => <i key={l.level} title={`Level ${l.level}: ${l.players}`} style={{ height: `${Math.max(l.players ? 4 : 1, l.players / maxPlayers * 100)}%` }} />)}
        </div>
        <div className={s.axis}><span>1</span><span>25</span><span>50</span><span>75</span><span>{data.maxLevel}</span></div>
      </div>

      <Arrears data={data} draft={draft} upd={upd} onDone={load} />

      <Big data={data} draft={draft} upd={upd} />

      <div className={`panel ${s.block}`}>
        <h3>Levele i nagrody</h3>
        <div className={s.tools}>
          {([['all', 'Wszystkie'], ['changed', 'Zmienione'], ['big', 'Duże nagrody'], ['special', 'Ze specjalną']] as [Filter, string][]).map(([id, label]) =>
            <button key={id} type="button" className={`${s.tab}${filter === id ? ` ${s.active}` : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
          <input className={s.finder} value={q} onChange={e => setQ(e.target.value)} placeholder="Level albo nagroda (np. 50, MEGA)" aria-label="Szukaj levelu albo nagrody" />
        </div>
        <div className={s.levels}>
          {shown.map(l => {
            const r = draft.rewards[l.level] ?? { small: [], special: [] };
            const isOpen = open === l.level;
            return (
              <article key={l.level} className={`${s.lvl}${draft.choice.includes(l.level) ? ` ${s.tens}` : ''}${changed(l) ? ` ${s.mod}` : ''}`}>
                <button type="button" className={s.lvlHead} onClick={() => setOpen(isOpen ? null : l.level)} aria-expanded={isOpen}>
                  <b className={s.n}>{l.level}</b>
                  <span className={s.rew}><small>Nagroda</small>{l.level === 1 ? 'start (bez nagrody)' : rewardsText(r.small, data)}</span>
                  <span className={s.rew}><small>Specjalna</small>{rewardsText(r.special, data)}</span>
                  <span className={s.meta}>{draft.choice.includes(l.level) ? 'DUŻA NAGRODA (wybór 2 z 4) · ' : ''}{l.level < data.maxLevel ? `${l.need.toLocaleString('pl-PL')} EXP do nast.` : 'maksimum'} · od {l.total.toLocaleString('pl-PL')} · graczy: {l.players}</span>
                </button>
                {isOpen && (
                  <div className={s.lvlBody}>
                    {l.level < data.maxLevel && (
                      <label className={s.needBox}>EXP do następnego levelu
                        <input inputMode="numeric" value={draft.needs[l.level] ?? ''} placeholder={String(l.curveNeed)} onChange={e => { const n = { ...draft.needs }; if (e.target.value === '') delete n[l.level]; else n[l.level] = e.target.value.replace(/\D/g, ''); upd({ needs: n }); }} />
                        <small className="muted">Puste = z krzywej ({l.curveNeed}).</small></label>
                    )}
                    {l.level > 1 ? <>
                      <label className={s.chk}><input type="checkbox" checked={draft.choice.includes(l.level)} onChange={e => upd({ choice: e.target.checked ? [...draft.choice, l.level].sort((a, b) => a - b) : draft.choice.filter(x => x !== l.level) })} /> Duża nagroda na tym levelu (gracz wybiera 2 z 4, poza nagrodą standardową i specjalną)</label>
                      <h4>Nagroda standardowa</h4>
                      <RewardsEditor value={r.small} onChange={v => setReward(l.level, 'small', v)} options={data} listId="expCards" label={`Nagroda levelu ${l.level}`} />
                      <h4>Nagroda specjalna (opcjonalna)</h4>
                      <RewardsEditor value={r.special} onChange={v => setReward(l.level, 'special', v)} options={data} listId="expCards" label={`Nagroda specjalna levelu ${l.level}`} />
                      <div className={s.btns}>
                        <Button onClick={() => upd({ rewards: { ...draft.rewards, [l.level]: { small: l.defaultSmall, special: l.defaultSpecial } }, needs: (() => { const n = { ...draft.needs }; delete n[l.level]; return n; })() })}>Domyślne dla levelu {l.level}</Button>
                        <Button onClick={() => setReward(l.level, 'small', [])}>Usuń nagrodę standardową</Button>
                      </div>
                    </> : <p className="muted small">Level 1 to start konta - nagrody zaczynają się od levelu 2.</p>}
                  </div>
                )}
              </article>
            );
          })}
          {!shown.length && <p className="muted">Nic nie pasuje do filtra.</p>}
        </div>
      </div>

      <Grant onDone={load} />

      <div className={s.save}>
        <Button kind="hue" disabled={busy || !dirty} onClick={save}>Zapisz ustawienia</Button>
        <Button disabled={busy} onClick={reset}>Przywróć domyślne</Button>
        {dirty && <span className={s.dirty}>Niezapisane zmiany</span>}
      </div>
    </section>
  );
}

interface ArrearsData {
  players: number; levels: number; notSettled: number; auto: boolean;
  perLevel: { level: number; players: number }[]; top: { id: number; name: string; levels: number }[];
  totals: { money: number; euro: number; cards: number; cosmetics: number; choices: number; chests: Record<string, number> };
  run: { running: boolean; total: number; done: number; players: number; levels: number; errors: number; startedAt: number; finishedAt: number; by: string };
}

/** Zaległe nagrody za levele (src/exp.rs `pay_arrears`): podgląd (kto, ile leveli, suma nagród), wypłata wszystkim w tle i samoczynna wypłata przy wizycie gracza */
function Arrears({ data, draft, upd, onDone }: { data: Data; draft: Draft; upd: (p: Partial<Draft>) => void; onDone: () => void }) {
  const [a, setA] = useState<ArrearsData | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<ArrearsData>('/api/admin/exp/arrears').then(setA).catch(e => toast(e.message, true));
  useEffect(() => { load(); }, []);
  const running = a?.run.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => { if (a && !running && a.run.finishedAt) onDone(); }, [running]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return null;
  const n = (x: number) => x.toLocaleString('pl-PL');
  const chests = Object.entries(a.totals.chests).map(([k, c]) => `${data.chests.find(x => x.kind === k)?.name || k} ×${n(c)}`);
  const summary = [a.totals.money ? `${n(a.totals.money)} gr` : '', a.totals.euro ? `${n(a.totals.euro)} euro` : '', a.totals.cards ? `${n(a.totals.cards)} kart` : '', ...chests, a.totals.cosmetics ? `${n(a.totals.cosmetics)} kosmetyków` : ''].filter(Boolean).join(', ') || 'brak';
  const pay = async () => {
    if (!confirm(`Wypłacić zaległe nagrody za levele? Dostanie je ${n(a.players)} graczy (${n(a.levels)} leveli): ${summary}. Na levelach z dużą nagrodą (${n(a.totals.choices)}) gracze dostaną do wyboru 2 z 4. Wypłata idzie w tle i jest bezpieczna do powtórzenia (nikt nie dostanie nagrody za ten sam level drugi raz), ale wypłaconych nagród nie da się cofnąć.`)) return;
    setBusy(true);
    try { await api('/api/admin/exp/arrears', { confirm: true }); toast('Wypłata zaległych nagród ruszyła'); await load(); } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const r = a.run;
  const pct = r.total ? Math.round(r.done / r.total * 100) : 0;
  return (
    <div className={`panel ${s.block}`}>
      <h3>Zaległe nagrody za levele</h3>
      <p className="muted small">Gracze, którym nagród za levele nie wypłacono: konta przeliczone z historii (levele zaliczone bez nagród przy pierwszym wejściu po wprowadzeniu EXP) i levele bez wpisu. Wypłata daje za każdy brakujący level
        2-99 bieżącego cyklu nagrodę standardową i specjalną wg tabeli niżej (a na levelach z dużą nagrodą - wybór 2 z 4, który gracz zobaczy przy następnym wejściu), a graczowi pokaże się jedno zbiorcze okno „Nowy level”.
        Levele ustawione ręcznie przez admina („Ustaw level”) są świadomie bez nagród i nie wchodzą w zaległości. Konta, które jeszcze nie weszły od aktualizacji ({n(a.notSettled)}), zostaną przeliczone przy wypłacie.</p>
      {a.levels === 0 ? <p>Brak zaległości do wypłaty.</p> : <>
        <p><b>{n(a.players)}</b> graczy, <b>{n(a.levels)}</b> leveli do wypłaty. Suma nagród: {summary}.{a.totals.choices ? ` Duże nagrody do wyboru: ${n(a.totals.choices)}.` : ''}</p>
        <div className={s.arrGrid}>
          <div>
            <h4>Najwięcej zaległości</h4>
            <ol className={s.arrList}>{a.top.map(t => <li key={t.id}><span>{t.name}</span><b>{t.levels}</b></li>)}</ol>
          </div>
          <div>
            <h4>Graczy z zaległością na levelu</h4>
            <div className={s.arrChips}>{a.perLevel.map(l => <span key={l.level} className={s.chip} title={`Level ${l.level}: ${l.players} graczy`}>{l.level}: {n(l.players)}</span>)}</div>
          </div>
        </div>
      </>}
      {(r.running || r.finishedAt > 0) && (
        <div role="status">
          <div className={s.arrProg}><i style={{ width: `${r.running ? pct : 100}%` }} /></div>
          <p className="muted small">{r.running ? `Wypłata w toku (${r.by}): ${n(r.done)} / ${n(r.total)} graczy (${pct}%)` : `Ostatnia wypłata (${r.by}) zakończona`}; wypłacono ${n(r.levels)} leveli ${n(r.players)} graczom{r.errors ? `, błędów: ${r.errors} (szczegóły w logu serwera, wypłatę można powtórzyć)` : ''}.</p>
        </div>
      )}
      <label className={s.chk}><input type="checkbox" checked={draft.autoArrears} onChange={e => upd({ autoArrears: e.target.checked })} /> Wypłacaj zaległe nagrody samoczynnie przy następnej wizycie gracza (zapisuje się przyciskiem „Zapisz ustawienia” na dole; teraz: {a.auto ? 'włączone' : 'wyłączone'})</label>
      <div className={s.btns}>
        <Button kind="hue" disabled={busy || running || a.levels === 0} onClick={pay}>Wypłać zaległe nagrody</Button>
        <Button disabled={busy} onClick={load}>Odśwież podgląd</Button>
      </div>
    </div>
  );
}

/** Ręczne nadanie EXP / ustawienie levelu gracza (dziennik admina `exp_grant`) */
function Grant({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'add' | 'set_exp' | 'set_level'>('add');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const v = parseInt(value, 10);
    if (!name.trim() || !Number.isFinite(v)) return toast('Podaj gracza i liczbę', true);
    const what = mode === 'add' ? `dodać ${v} EXP` : mode === 'set_exp' ? `ustawić EXP na ${v}` : `ustawić level ${v} (bez nagród za przeskoczone levele)`;
    if (!confirm(`Czy na pewno ${what} graczowi ${name.trim()}?`)) return;
    setBusy(true);
    try {
      const r = await api<{ exp: number; level: number; paysRewards: boolean }>('/api/admin/exp/grant', { username: name.trim(), mode, value: v });
      toast(`${name.trim()}: ${r.exp.toLocaleString('pl-PL')} EXP, level ${r.level}${r.paysRewards ? ' (nagrody wypłaci się przy jego następnym wejściu)' : ''}`);
      setValue('');
      onDone();
    } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  return (
    <div className={`panel ${s.block}`}>
      <h3>Ręczne nadanie EXP</h3>
      <p className="muted small">Dodanie EXP wypłaca nagrody za nowe levele przy następnym wejściu gracza. „Ustaw level” (1-99) przestawia EXP na próg levelu i zalicza przeskoczone levele bez nagród; level 100 gracz osiąga sam (odznaka i reset). Zapis trafia do dziennika adminów.</p>
      <div className={s.fields}>
        <label>Gracz (nazwa)<input value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
        <label>Co zrobić<select value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="add">Dodaj / odejmij EXP</option><option value="set_exp">Ustaw EXP</option><option value="set_level">Ustaw level</option></select></label>
        <label>Wartość<input inputMode="numeric" value={value} onChange={e => setValue(e.target.value.replace(/[^\d-]/g, ''))} /></label>
        <Button disabled={busy} onClick={send}>Wykonaj</Button>
      </div>
    </div>
  );
}

/** Duże nagrody (wybór 2 z 4): zasady, szansa na slot z puli ekskluzywnej z leveli i sama pula (karty w wariantach, skrzynki) */
function Big({ data, draft, upd }: { data: Data; draft: Draft; upd: (p: Partial<Draft>) => void }) {
  const [card, setCard] = useState('');
  const [variant, setVariant] = useState('normal');
  const [chest, setChest] = useState('');
  const cardName = (id: string) => data.cards.find(c => c.id === id)?.name;
  const addCard = () => {
    const person = card.trim();
    if (!cardName(person)) return toast('Podaj id istniejącej karty', true);
    if (draft.exCards.some(c => c.person === person && c.variant === variant)) return;
    upd({ exCards: [...draft.exCards, { person, variant }] });
    setCard('');
  };
  const addChest = () => {
    if (chest && !draft.exChests.includes(chest)) upd({ exChests: [...draft.exChests, chest] });
    setChest('');
  };
  return (
    <div className={`panel ${s.block}`}>
      <h3>Duże nagrody (wybór 2 z 4) i pula „ekskluzywne z leveli”</h3>
      <p className="muted small">Na każdym levelu zaznaczonym jako „duża nagroda” (domyślnie co 10.) gracz dostaje do wyboru 4 opcje i bierze 2, reszta przepada: (1) losowa skrzynka z pieniędzmi - spośród WSZYSTKICH skrzynek z pieniędzmi w grze,
        więc nowe skrzynki dołączą same, (2) i (3) losowe karty Mityczna lub wyższej, też w wariantach (bez kart ekskluzywnych w jakiejkolwiek skrzynce, bez kart specjalnych i tajnych i bez wariantów ekskluzywnych),
        (4) slot dodatkowy: z szansą poniżej coś z puli ekskluzywnej z leveli (karta albo skrzynka), a najczęściej po prostu kolejna losowa karta Mityczna+. Karty z puli nie wypadają w slotach 2-4 jako zwykłe karty.
        Żeby karta była naprawdę „tylko z leveli”, nie przypinaj jej do skrzynek ze sklepu (np. dodaj ją bez skrzynki).</p>
      <div className={s.fields}>
        <label>Szansa na slot ekskluzywny (%)<input inputMode="numeric" value={draft.chance} onChange={e => upd({ chance: e.target.value.replace(/\D/g, '') })} /><small className="muted">Działa tylko, gdy pula niżej nie jest pusta. Domyślnie 20.</small></label>
      </div>
      <h4>Ekskluzywne karty z leveli</h4>
      <div className={s.pool}>
        {draft.exCards.map((c, i) => (
          <span key={`${c.person}:${c.variant}`} className={s.chip}>{cardName(c.person) || c.person}{c.variant !== 'normal' ? ` (${data.variants.find(v => v.key === c.variant)?.name || c.variant})` : ''}
            <button type="button" className={s.x} aria-label={`Usuń ${cardName(c.person) || c.person} z puli`} onClick={() => upd({ exCards: draft.exCards.filter((_, j) => j !== i) })}>×</button></span>
        ))}
        {!draft.exCards.length && <span className="muted small">Pusta: nie ma jeszcze żadnych kart ekskluzywnych z leveli.</span>}
      </div>
      <div className={s.fields}>
        <label>Karta (id)<input list="expCards" value={card} placeholder="np. pl_malysz" onChange={e => setCard(e.target.value)} />{card && <small className={cardName(card.trim()) ? 'muted' : s.bad}>{cardName(card.trim()) || 'nie ma takiej karty'}</small>}</label>
        <label>Wariant<select value={variant} onChange={e => setVariant(e.target.value)}><option value="normal">Zwykła</option>{data.variants.map(v => <option key={v.key} value={v.key}>{v.name}{v.enabled ? '' : ' (wyłączony)'}</option>)}</select></label>
        <Button onClick={addCard}>Dodaj kartę</Button>
      </div>
      <h4>Ekskluzywne skrzynki z leveli</h4>
      <div className={s.pool}>
        {draft.exChests.map(k => (
          <span key={k} className={s.chip}>{data.chests.find(c => c.kind === k)?.name || k}
            <button type="button" className={s.x} aria-label={`Usuń ${k} z puli`} onClick={() => upd({ exChests: draft.exChests.filter(x => x !== k) })}>×</button></span>
        ))}
        {!draft.exChests.length && <span className="muted small">Pusta.</span>}
      </div>
      <div className={s.fields}>
        <label>Skrzynka<select value={chest} onChange={e => setChest(e.target.value)}><option value="">wybierz…</option>{data.chests.map(c => <option key={c.kind} value={c.kind}>{c.name}</option>)}</select></label>
        <Button disabled={!chest} onClick={addChest}>Dodaj skrzynkę</Button>
      </div>
    </div>
  );
}
