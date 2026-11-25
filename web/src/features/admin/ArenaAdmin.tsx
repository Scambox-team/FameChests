import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { abilityText, rangeText, type Ability } from '../arena/abilities';
import './arenaAdmin.css';

// Panel admina „Arena” (server/src/routes/arena_admin.rs, src/arena/rules.rs): ustawienia meczu i dostęp dla wszystkich,
// statystyki kart, domyślne statystyki rzadkości i specjalizacji („zastosuj do wszystkich”), klasy, specjalizacje,
// ukryte cechy i układy. Słowniki (wszystko poza ustawieniami meczu i kartami) zapisuje jeden przycisk.

interface Named { id: string; name: string }
interface Defaults { hp: number | null; atk: number | null; rangeMin: number | null; rangeMax: number | null }
interface Spec extends Named { defaults: Defaults }
interface ComboEffect { kind: string; amount: number; all: boolean }
interface Combo { id: string; name: string; trait: string; value: string; count: number; effects: ComboEffect[] }
interface Meta { classes: Named[]; specs: Spec[]; traits: Record<string, string[]>; combos: Combo[]; rarityDefaults: Record<string, Defaults> }
interface Stats {
  atk: number; hp: number; class: string; spec: string; rangeMin: number; rangeMax: number; abilities: Ability[];
  traits: Record<string, string>; points: number | null;
}
interface CardRow { id: string; name: string; rarity: string; crates: string[]; secret: boolean; points: number; custom: boolean; stats: Stats }
type Settings = Record<string, any> & { points: Record<string, number> };
interface Data {
  public: boolean; settings: Settings; defaults: { settings: Settings; meta: Meta }; meta: Meta;
  traits: Named[]; kinds: { id: string; name: string; modes: Named[] }[]; specials: (Named & { desc: string })[];
  cards: CardRow[]; rarities: Named[]; crates: Named[]; applied?: number;
}

type Tab = 'match' | 'cards' | 'defaults' | 'dicts' | 'traits' | 'combos';
const TABS: [Tab, string][] = [['match', 'Mecz'], ['cards', 'Karty'], ['defaults', 'Domyślne statystyki'], ['dicts', 'Klasy i specjalizacje'], ['traits', 'Ukryte cechy'], ['combos', 'Układy']];

const SETTINGS: [string, string, string][] = [
  ['gameSecs', 'Czas meczu (s)', 'Po tym czasie wygrywa strona z większą liczbą punktów'],
  ['overtimeSecs', 'Dogrywka (s)', 'Dokładana przy remisie'],
  ['maxOvertimes', 'Najwięcej dogrywek', 'Potem remis'],
  ['moves', 'Ruchy na turę', 'Wystawienie, wycofanie, umiejętność'],
  ['turnSecs', 'Czas tury (s)', ''],
  ['rows', 'Linie (rzędy)', ''],
  ['rowSlots', 'Miejsca w linii', ''],
  ['deckSize', 'Kart w talii', ''],
  ['startMoney', 'Pieniądze na start', 'Waluta meczu, nie grosze'],
  ['moneyPerTurn', 'Pieniądze na turę', 'Na początku każdej tury gracza'],
  ['maxMoney', 'Najwięcej pieniędzy', ''],
  ['reviveTurns', 'Powrót po turach', 'Umiejętność specjalna „Powrót”'],
  ['rewardPvp', 'Nagroda: wygrana z człowiekiem (gr)', ''],
  ['rewardBot', 'Nagroda: wygrany trening (gr)', 'Powinna być mniejsza'],
  ['dailyPvp', 'Limit nagradzanych wygranych z ludźmi / dobę', ''],
  ['dailyBot', 'Limit nagradzanych treningów / dobę', ''],
  ['minRewardSecs', 'Nagroda po poddaniu rywala od (s)', 'Mecz z człowiekiem zakończony poddaniem lub walkowerem'],
];

const slug = (name: string) => (name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'x') + '_' + Math.random().toString(36).slice(2, 6);
const num = (v: string) => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : 0; };
const optNum = (v: string) => v.trim() === '' ? null : num(v);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ł/g, 'l');
const NEW_ABILITY: Ability = { name: 'Cios', kind: 'attack', mode: 'normal', power: 100, area: false, count: 0, aim: true, turns: 0, cost: 0, from: 'enemy' };

export default function ArenaAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>('match');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const take = (d: Data) => { setData(d); setMeta(structuredClone(d.meta)); setSettings(structuredClone(d.settings)); };
  useEffect(() => { api<Data>('/api/admin/arena').then(take, e => toast(e.message, true)); }, []);
  if (!data || !meta || !settings) return <p>Wczytywanie</p>;

  const metaDirty = JSON.stringify(meta) !== JSON.stringify(data.meta);
  const setDirty = JSON.stringify(settings) !== JSON.stringify(data.settings);
  const run = async (fn: () => Promise<Data | void>, done?: string) => {
    if (busy) return;
    setBusy(true);
    try { const d = await fn(); if (d) take(d); if (done) toast(done); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };
  const saveMeta = (reset = false) => run(() => api<Data>('/api/admin/arena/meta', reset ? { reset: true } : { meta }), 'Zapisano');
  const metaBar = (
    <div className="aa-savebar">
      <Button kind="hue" disabled={!metaDirty || busy} onClick={() => saveMeta()}>Zapisz słowniki</Button>
      <Button kind="quiet" disabled={!metaDirty} onClick={() => setMeta(structuredClone(data.meta))}>Cofnij zmiany</Button>
      {metaDirty && <span className="aa-warn">Niezapisane zmiany</span>}
    </div>
  );

  return (
    <div className="aa">
      <header className="aa-head">
        <h2>Arena</h2>
        <label className="aa-switch">
          <input type="checkbox" checked={data.public} disabled={busy} onChange={e => {
            const on = e.target.checked;
            if (on && !confirm('Udostępnić Arenę wszystkim graczom? Zakładka pojawi się w menu, a nagrody w groszach zaczną trafiać do graczy.')) return;
            run(() => api<Data>('/api/admin/arena/settings', { public: on }), on ? 'Arena jest dostępna dla wszystkich' : 'Arena tylko dla adminów');
          }} />
          <span>Arena dla wszystkich</span>
          <small>{data.public ? 'włączona - gracze widzą zakładkę' : 'wyłączona - tylko admini'}</small>
        </label>
      </header>
      <nav className="aa-tabs" aria-label="Działy Areny">
        {TABS.map(([id, label]) => <button key={id} type="button" className={`aa-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </nav>

      {tab === 'match' && (
        <section className="aa-block">
          <p className="aa-muted">Ustawienia obowiązują w nowych meczach. Punkty rzadkości to jednocześnie koszt wystawienia karty (w pieniądzach meczu) i nagroda w punktach za jej pokonanie.</p>
          <div className="aa-fields">
            {SETTINGS.map(([k, label, hint]) => (
              <label key={k}>{label}
                <input type="number" value={settings[k]} onChange={e => setSettings({ ...settings, [k]: num(e.target.value) })} />
                {hint && <small>{hint}</small>}
                {settings[k] !== data.defaults.settings[k] && <small className="aa-warn">domyślnie {data.defaults.settings[k]}</small>}
              </label>
            ))}
          </div>
          <h3>Punkty za rzadkość</h3>
          <div className="aa-fields">
            {data.rarities.map(r => (
              <label key={r.id}>{r.name}
                <input type="number" value={settings.points[r.id] ?? 1} onChange={e => setSettings({ ...settings, points: { ...settings.points, [r.id]: num(e.target.value) } })} />
              </label>
            ))}
          </div>
          <div className="aa-savebar">
            <Button kind="hue" disabled={!setDirty || busy} onClick={() => run(() => api<Data>('/api/admin/arena/settings', { settings }), 'Zapisano')}>Zapisz ustawienia meczu</Button>
            <Button kind="quiet" onClick={() => { if (confirm('Przywrócić domyślne ustawienia meczu?')) run(() => api<Data>('/api/admin/arena/settings', { reset: true }), 'Przywrócono'); }}>Przywróć domyślne</Button>
          </div>
        </section>
      )}

      {tab === 'cards' && <CardsTab data={data} meta={data.meta} onSaved={row => setData({ ...data, cards: data.cards.map(c => c.id === row.id ? { ...c, ...row } : c) })} />}

      {tab === 'defaults' && (
        <section className="aa-block">
          <p className="aa-muted">Karty bez własnych statystyk biorą HP, atak i zasięg z rzadkości. Przycisk „Zastosuj do wszystkich” wpisuje daną statystykę z wybranego źródła do każdej karty (ze specjalizacji: tylko karty, które ją mają). Ostatnie zastosowanie danej statystyki wygrywa, np. HP z rzadkości i atak ze specjalizacji.</p>
          <h3>Rzadkości</h3>
          <DefaultsTable rows={data.rarities.map(r => ({ id: r.id, name: r.name, d: meta.rarityDefaults[r.id] ?? { hp: null, atk: null, rangeMin: null, rangeMax: null } }))}
            onChange={(id, d) => setMeta({ ...meta, rarityDefaults: { ...meta.rarityDefaults, [id]: d } })} />
          <h3>Specjalizacje</h3>
          <DefaultsTable rows={meta.specs.map(s => ({ id: s.id, name: s.name, d: s.defaults }))}
            onChange={(id, d) => setMeta({ ...meta, specs: meta.specs.map(s => s.id === id ? { ...s, defaults: d } : s) })} />
          {metaBar}
          <h3>Zastosuj do wszystkich kart</h3>
          {metaDirty && <p className="aa-warn">Najpierw zapisz zmiany - stosowane są zapisane wartości.</p>}
          <div className="aa-apply">
            {([['hp', 'HP'], ['atk', 'Atak'], ['range', 'Zasięg']] as const).map(([stat, label]) => (
              <div key={stat}>
                <b>{label}</b>
                {([['rarity', 'z rzadkości'], ['spec', 'ze specjalizacji']] as const).map(([src, sl]) => (
                  <Button key={src} disabled={busy || metaDirty} onClick={() => {
                    if (!confirm(`Ustawić ${label} ${sl} we wszystkich kartach? Wcześniejsze wartości tej statystyki zostaną nadpisane.`)) return;
                    run(async () => { const d = await api<Data>('/api/admin/arena/apply', { stat, source: src }); toast(`Zmieniono kart: ${d.applied ?? 0}`); return d; });
                  }}>{label} {sl}</Button>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'dicts' && (
        <section className="aa-block">
          <p className="aa-muted">Klasa postaci (np. polityk, artysta) i specjalizacja (np. mag, żołnierz, bokser) są jawne. Specjalizacja sama nie zmienia gry - według niej ustawia się domyślne statystyki (dział „Domyślne statystyki”). Obie mogą tworzyć układy.</p>
          <div className="aa-two">
            <NamedList title="Klasy postaci" items={meta.classes} onChange={classes => setMeta({ ...meta, classes })} />
            <NamedList title="Specjalizacje" items={meta.specs} onChange={specs => setMeta({ ...meta, specs: specs.map(s => ({ ...s, defaults: (s as Partial<Spec>).defaults ?? { hp: null, atk: null, rangeMin: null, rangeMax: null } })) })} />
          </div>
          {metaBar}
        </section>
      )}

      {tab === 'traits' && (
        <section className="aa-block">
          <p className="aa-muted">Ukryte cechy nie są widoczne na karcie ani w meczu (w podglądzie karty widzi je tylko admin). Działają przez układy. Tu ustala się słowniki wartości; wartość karty wybiera się w dziale „Karty”.</p>
          {data.traits.map(t => <ValueList key={t.id} title={t.name} values={meta.traits[t.id] ?? []} onChange={v => setMeta({ ...meta, traits: { ...meta.traits, [t.id]: v } })} />)}
          {metaBar}
        </section>
      )}

      {tab === 'combos' && (
        <section className="aa-block">
          <p className="aa-muted">Układ działa, gdy na planszy gracza stoi co najmniej tyle kart z daną cechą. Pusta wartość = dowolna, byle wspólna (np. 3 karty tej samej partii). Skutki: atak / HP dla kart układu albo wszystkich kart gracza, pieniądze co turę, punkty za każdą pokonaną kartę.</p>
          {meta.combos.map((c, i) => (
            <ComboEditor key={c.id} combo={c} meta={meta} traits={data.traits} classes={meta.classes} specs={meta.specs}
              onChange={nc => setMeta({ ...meta, combos: meta.combos.map((x, j) => j === i ? nc : x) })}
              onRemove={() => setMeta({ ...meta, combos: meta.combos.filter((_, j) => j !== i) })} />
          ))}
          <div><Button onClick={() => setMeta({ ...meta, combos: [...meta.combos, { id: slug('uklad'), name: 'Nowy układ', trait: 'party', value: '', count: 3, effects: [{ kind: 'atk', amount: 5, all: false }] }] })}>Dodaj układ</Button></div>
          {metaBar}
        </section>
      )}

      {tab !== 'match' && tab !== 'cards' && (
        <p className="aa-muted"><button type="button" className="aa-link" onClick={() => { if (confirm('Przywrócić domyślne słowniki, układy i domyślne statystyki?')) saveMeta(true); }}>Przywróć domyślne słowniki</button></p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- domyślne statystyki

function DefaultsTable({ rows, onChange }: { rows: { id: string; name: string; d: Defaults }[]; onChange: (id: string, d: Defaults) => void }) {
  const field = (r: { id: string; d: Defaults }, k: keyof Defaults) => (
    <input type="number" aria-label={k} value={r.d[k] ?? ''} placeholder="-" onChange={e => onChange(r.id, { ...r.d, [k]: optNum(e.target.value) })} />
  );
  return (
    <table className="aa-table">
      <thead><tr><th>Nazwa</th><th>HP</th><th>Atak</th><th>Zasięg od</th><th>Zasięg do</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td>{r.name}</td><td>{field(r, 'hp')}</td><td>{field(r, 'atk')}</td><td>{field(r, 'rangeMin')}</td><td>{field(r, 'rangeMax')}</td></tr>)}</tbody>
    </table>
  );
}

// ---------------------------------------------------------------- słowniki

function NamedList<T extends Named>({ title, items, onChange }: { title: string; items: T[]; onChange: (v: T[]) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="aa-card">
      <h3>{title}</h3>
      {items.map((it, i) => (
        <div key={it.id} className="aa-line">
          <input value={it.name} aria-label="Nazwa" onChange={e => onChange(items.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
          <Button kind="quiet" onClick={() => { if (confirm(`Usunąć „${it.name}”? Karty z tą wartością stracą ją przy zapisie.`)) onChange(items.filter((_, j) => j !== i)); }}>Usuń</Button>
        </div>
      ))}
      <form className="aa-line" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; onChange([...items, { id: slug(name), name: name.trim() } as T]); setName(''); }}>
        <input value={name} placeholder="Nowa nazwa" onChange={e => setName(e.target.value)} />
        <Button type="submit">Dodaj</Button>
      </form>
    </div>
  );
}

function ValueList({ title, values, onChange }: { title: string; values: string[]; onChange: (v: string[]) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="aa-card">
      <h3>{title} <span className="aa-muted">{values.length}</span></h3>
      <div className="aa-chips">
        {values.map(x => <span key={x} className="aa-chip">{x}<button type="button" aria-label={`Usuń ${x}`} onClick={() => onChange(values.filter(y => y !== x))}>×</button></span>)}
        {!values.length && <span className="aa-muted">Brak wartości</span>}
      </div>
      <form className="aa-line" onSubmit={e => { e.preventDefault(); const t = v.trim(); if (t && !values.includes(t)) onChange([...values, t]); setV(''); }}>
        <input value={v} placeholder="Nowa wartość" onChange={e => setV(e.target.value)} />
        <Button type="submit">Dodaj</Button>
      </form>
    </div>
  );
}

function ComboEditor({ combo: c, meta, traits, classes, specs, onChange, onRemove }: {
  combo: Combo; meta: Meta; traits: Named[]; classes: Named[]; specs: Named[]; onChange: (c: Combo) => void; onRemove: () => void;
}) {
  const options = c.trait === 'class' ? classes.map(x => ({ v: x.id, n: x.name })) : c.trait === 'spec' ? specs.map(x => ({ v: x.id, n: x.name }))
    : (meta.traits[c.trait] ?? []).map(x => ({ v: x, n: x }));
  return (
    <div className="aa-card">
      <div className="aa-fields">
        <label>Nazwa<input value={c.name} onChange={e => onChange({ ...c, name: e.target.value })} /></label>
        <label>Cecha
          <select value={c.trait} onChange={e => onChange({ ...c, trait: e.target.value, value: '' })}>
            {traits.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="class">Klasa postaci</option>
            <option value="spec">Specjalizacja</option>
          </select>
        </label>
        <label>Wartość
          <select value={c.value} onChange={e => onChange({ ...c, value: e.target.value })}>
            <option value="">dowolna (wspólna)</option>
            {options.map(o => <option key={o.v} value={o.v}>{o.n}</option>)}
          </select>
        </label>
        <label>Ile kart<input type="number" min={1} value={c.count} onChange={e => onChange({ ...c, count: num(e.target.value) })} /></label>
      </div>
      {c.effects.map((ef, i) => (
        <div key={i} className="aa-line">
          <select value={ef.kind} aria-label="Skutek" onChange={e => onChange({ ...c, effects: c.effects.map((x, j) => j === i ? { ...x, kind: e.target.value } : x) })}>
            <option value="atk">Atak</option><option value="hp">HP</option><option value="money">Pieniądze co turę</option><option value="points">Punkty za pokonaną kartę</option>
          </select>
          <input type="number" aria-label="Wartość" value={ef.amount} onChange={e => onChange({ ...c, effects: c.effects.map((x, j) => j === i ? { ...x, amount: num(e.target.value) } : x) })} />
          {(ef.kind === 'atk' || ef.kind === 'hp') && (
            <label className="aa-check"><input type="checkbox" checked={ef.all} onChange={e => onChange({ ...c, effects: c.effects.map((x, j) => j === i ? { ...x, all: e.target.checked } : x) })} /> wszystkim kartom</label>
          )}
          <Button kind="quiet" onClick={() => onChange({ ...c, effects: c.effects.filter((_, j) => j !== i) })}>Usuń skutek</Button>
        </div>
      ))}
      <div className="aa-line">
        {c.effects.length < 4 && <Button onClick={() => onChange({ ...c, effects: [...c.effects, { kind: 'atk', amount: 5, all: false }] })}>Dodaj skutek</Button>}
        <Button kind="quiet" onClick={() => { if (confirm(`Usunąć układ „${c.name}”?`)) onRemove(); }}>Usuń układ</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- karty

function CardsTab({ data, meta, onSaved }: { data: Data; meta: Meta; onSaved: (row: CardRow) => void }) {
  const [q, setQ] = useState('');
  const [rarity, setRarity] = useState('');
  const [crate, setCrate] = useState('');
  const [spec, setSpec] = useState('');
  const [only, setOnly] = useState<'' | 'custom' | 'default'>('');
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState<string | null>(null);
  const rarName = (id: string) => data.rarities.find(r => r.id === id)?.name ?? id;
  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return data.cards.filter(c => {
      if (rarity && c.rarity !== rarity) return false;
      if (crate && !c.crates.includes(crate)) return false;
      if (spec && c.stats.spec !== (spec === '-' ? '' : spec)) return false;
      if (only === 'custom' && !c.custom) return false;
      if (only === 'default' && c.custom) return false;
      if (!words.length) return true;
      const text = norm(`${c.name} ${c.id} ${c.stats.abilities.map(a => a.name).join(' ')} ${Object.values(c.stats.traits).join(' ')}`);
      return words.every(w => text.includes(w));
    });
  }, [data.cards, q, rarity, crate, spec, only]);
  return (
    <section className="aa-block">
      <div className="aa-filters">
        <input type="search" placeholder="Szukaj: nazwa, id, umiejętność, cecha" value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj karty" />
        <select value={rarity} onChange={e => setRarity(e.target.value)} aria-label="Rzadkość"><option value="">Każda rzadkość</option>{data.rarities.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select value={crate} onChange={e => setCrate(e.target.value)} aria-label="Skrzynka"><option value="">Każda skrzynka</option>{data.crates.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select value={spec} onChange={e => setSpec(e.target.value)} aria-label="Specjalizacja"><option value="">Każda specjalizacja</option><option value="-">bez specjalizacji</option>{meta.specs.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select value={only} onChange={e => setOnly(e.target.value as typeof only)} aria-label="Statystyki"><option value="">Wszystkie</option><option value="custom">Ustawione w panelu</option><option value="default">Z domyślnych</option></select>
        <span className="aa-muted">{list.length} z {data.cards.length}</span>
      </div>
      <div className="aa-cards">
        {list.slice(0, limit).map(c => (
          <div key={c.id} className={`aa-cardrow${open === c.id ? ' open' : ''}`}>
            <button type="button" className="aa-cardhead" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
              <span className="aa-cname"><b>{c.secret ? 'Tajna: ' : ''}{c.name}</b> <span className="aa-muted">{rarName(c.rarity)}</span></span>
              <span>Atak {c.stats.atk}</span><span>HP {c.stats.hp}</span><span>Zasięg {rangeText([c.stats.rangeMin, c.stats.rangeMax])}</span>
              <span>{meta.specs.find(s => s.id === c.stats.spec)?.name ?? '-'}</span><span>{c.points} pkt</span>
              <span className={c.custom ? 'aa-tag' : 'aa-muted'}>{c.custom ? 'z panelu' : 'domyślne'}</span>
            </button>
            {open === c.id && <CardEditor row={c} data={data} meta={meta} onSaved={onSaved} />}
          </div>
        ))}
      </div>
      {list.length > limit && <Button onClick={() => setLimit(l => l + 200)}>Pokaż więcej</Button>}
    </section>
  );
}

function CardEditor({ row, data, meta, onSaved }: { row: CardRow; data: Data; meta: Meta; onSaved: (row: CardRow) => void }) {
  const [s, setS] = useState<Stats>(() => structuredClone(row.stats));
  const [single, setSingle] = useState(row.stats.rangeMin === row.stats.rangeMax);
  const [busy, setBusy] = useState(false);
  const save = async (reset = false) => {
    setBusy(true);
    try {
      const stats = { ...s, rangeMax: single ? s.rangeMin : s.rangeMax };
      const r = await api<CardRow>(`/api/admin/arena/card/${encodeURIComponent(row.id)}`, reset ? { reset: true } : { stats });
      onSaved({ ...row, ...r });
      setS(structuredClone(r.stats));
      toast(reset ? 'Przywrócono domyślne' : 'Zapisano');
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };
  const fromSpec = () => {
    const sp = meta.specs.find(x => x.id === s.spec);
    if (!sp) return toast('Wybierz specjalizację', true);
    const d = sp.defaults;
    setS({ ...s, hp: d.hp ?? s.hp, atk: d.atk ?? s.atk, rangeMin: d.rangeMin ?? s.rangeMin, rangeMax: d.rangeMax ?? s.rangeMax });
  };
  const setAb = (i: number, a: Ability) => setS({ ...s, abilities: s.abilities.map((x, j) => j === i ? a : x) });
  return (
    <div className="aa-editor">
      <div className="aa-fields">
        <label>Atak<input type="number" value={s.atk} onChange={e => setS({ ...s, atk: num(e.target.value) })} /></label>
        <label>HP<input type="number" value={s.hp} onChange={e => setS({ ...s, hp: num(e.target.value) })} /></label>
        <label>Klasa
          <select value={s.class} onChange={e => setS({ ...s, class: e.target.value })}><option value="">brak</option>{meta.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label>Specjalizacja
          <select value={s.spec} onChange={e => setS({ ...s, spec: e.target.value })}><option value="">brak</option>{meta.specs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label>Punkty (koszt)
          <input type="number" placeholder={`z rzadkości: ${data.settings.points[row.rarity] ?? 1}`} value={s.points ?? ''} onChange={e => setS({ ...s, points: optNum(e.target.value) })} />
        </label>
      </div>
      <div className="aa-fields">
        <fieldset className="aa-range">
          <legend>Zasięg (1 = linia rywala tuż naprzeciw pierwszej linii)</legend>
          <label className="aa-check"><input type="radio" checked={!single} onChange={() => setSingle(false)} /> od - do</label>
          <label className="aa-check"><input type="radio" checked={single} onChange={() => setSingle(true)} /> tylko jeden rząd</label>
          <input type="number" min={1} aria-label={single ? 'Rząd' : 'Od'} value={s.rangeMin} onChange={e => setS({ ...s, rangeMin: num(e.target.value) })} />
          {!single && <input type="number" min={1} aria-label="Do" value={s.rangeMax} onChange={e => setS({ ...s, rangeMax: num(e.target.value) })} />}
        </fieldset>
        <Button kind="quiet" onClick={fromSpec}>Wypełnij ze specjalizacji</Button>
      </div>
      <h4>Ukryte cechy</h4>
      <div className="aa-fields">
        {data.traits.map(t => (
          <label key={t.id}>{t.name}
            <select value={s.traits[t.id] ?? ''} onChange={e => { const traits = { ...s.traits }; if (e.target.value) traits[t.id] = e.target.value; else delete traits[t.id]; setS({ ...s, traits }); }}>
              <option value="">brak</option>{(meta.traits[t.id] ?? []).map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        ))}
      </div>
      <h4>Umiejętności <span className="aa-muted">(najwyżej 4)</span></h4>
      {s.abilities.map((a, i) => <AbilityEditor key={i} a={a} data={data} atk={s.atk} onChange={x => setAb(i, x)} onRemove={() => setS({ ...s, abilities: s.abilities.filter((_, j) => j !== i) })} />)}
      {s.abilities.length < 4 && <div><Button onClick={() => setS({ ...s, abilities: [...s.abilities, { ...NEW_ABILITY }] })}>Dodaj umiejętność</Button></div>}
      <div className="aa-savebar">
        <Button kind="hue" disabled={busy} onClick={() => save()}>Zapisz kartę</Button>
        {row.custom && <Button kind="quiet" disabled={busy} onClick={() => { if (confirm('Usunąć statystyki z panelu? Karta wróci do domyślnych z rzadkości.')) save(true); }}>Przywróć domyślne</Button>}
      </div>
    </div>
  );
}

function AbilityEditor({ a, data, atk, onChange, onRemove }: { a: Ability; data: Data; atk: number; onChange: (a: Ability) => void; onRemove: () => void }) {
  const kind = data.kinds.find(k => k.id === a.kind);
  const timed = ['poison', 'regen', 'income'].includes(a.mode) || a.kind === 'shield';
  const targeted = a.kind === 'attack' || a.kind === 'shield' || (a.kind === 'heal');
  const set = (p: Partial<Ability>) => onChange({ ...a, ...p });
  return (
    <div className="aa-card aa-ab">
      <div className="aa-fields">
        <label>Nazwa<input value={a.name} onChange={e => set({ name: e.target.value })} /></label>
        <label>Typ
          <select value={a.kind} onChange={e => {
            const k = data.kinds.find(x => x.id === e.target.value);
            set({ kind: e.target.value, mode: e.target.value === 'special' ? data.specials[0]?.id ?? 'revive' : k?.modes[0]?.id ?? 'normal', power: e.target.value === 'attack' ? 100 : e.target.value === 'eco' ? 3 : 25 });
          }}>{data.kinds.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
        </label>
        <label>Odmiana
          <select value={a.mode} onChange={e => set({ mode: e.target.value })}>
            {a.kind === 'special' ? data.specials.map(s => <option key={s.id} value={s.id}>{s.name}</option>) : kind?.modes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        {a.kind !== 'special' && <>
          <label>{a.kind === 'attack' ? 'Siła (% ataku)' : a.kind === 'eco' ? 'Pieniądze' : 'HP'}<input type="number" value={a.power} onChange={e => set({ power: num(e.target.value) })} /></label>
          {timed && <label>{a.kind === 'shield' ? 'Tarcza na tur' : 'Przez tur'}<input type="number" value={a.turns} onChange={e => set({ turns: num(e.target.value) })} /></label>}
          <label>Koszt (pieniądze meczu)<input type="number" value={a.cost} onChange={e => set({ cost: num(e.target.value) })} /></label>
        </>}
      </div>
      {a.kind !== 'special' && a.kind !== 'eco' && (
        <div className="aa-fields">
          {targeted && a.mode !== 'drain' && <>
            <label className="aa-check"><input type="checkbox" checked={a.area} onChange={e => set({ area: e.target.checked })} /> obszarowa</label>
            {a.area && <label>Ile kart (0 = wszystkie)<input type="number" value={a.count} onChange={e => set({ count: num(e.target.value) })} /></label>}
          </>}
          <label className="aa-check"><input type="radio" checked={a.aim} onChange={() => set({ aim: true })} /> skierowana</label>
          <label className="aa-check"><input type="radio" checked={!a.aim} onChange={() => set({ aim: false })} /> losowa</label>
          {a.mode === 'drain' && (
            <label>Zabiera HP
              <select value={a.from} onChange={e => set({ from: e.target.value })}><option value="enemy">karcie rywala w zasięgu</option><option value="ally">innej własnej karcie</option></select>
            </label>
          )}
        </div>
      )}
      <p className="aa-muted">{abilityText(a, atk, data.specials)}</p>
      <div><Button kind="quiet" onClick={onRemove}>Usuń umiejętność</Button></div>
    </div>
  );
}
