import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import s from './GamesAdmin.module.css';

// Zakładka panelu admina „Gry”: wygląd Snake'a (routes/snake.rs) - kolor węża i tła, obrazki PNG.
interface Reward { perApple: number; minScore: number; perGame: number; daily: number }
interface RunReward { per100m: number; minDist: number; perGame: number; daily: number }
const RUN_FIELDS: [keyof RunReward, string, string][] = [
  ['per100m', 'Groszy za każde 100 m', 'gr'], ['minDist', 'Od ilu metrów', 'm'], ['perGame', 'Najwyżej za jedną grę', 'gr'], ['daily', 'Najwyżej na dzień (gracz)', 'gr'],
];
interface Look {
  color: string; background: string; defaults: { color: string; background: string }; images: Record<string, string | null>;
  sounds: { id: string; url: string }[]; maxSounds: number; reward: Reward;
}
const REWARD_FIELDS: [keyof Reward, string, string][] = [
  ['perApple', 'Groszy za jabłko', 'gr'], ['minScore', 'Od ilu jabłek', 'jabłek'], ['perGame', 'Najwyżej za jedną grę', 'gr'], ['daily', 'Najwyżej na dzień (gracz)', 'gr'],
];
const SLOTS: [string, string, string][] = [
  ['head', 'Głowa węża', 'Patrzy w prawo, gra obraca ją w stronę ruchu. Najlepiej kwadrat z przezroczystym tłem.'],
  ['body', 'Ciało węża', 'Jeden segment (kratka), też patrzy w prawo. Bez obrazka ciało rysuje się w kolorze węża.'],
  ['apple', 'Jabłko', 'Kwadrat z przezroczystym tłem.'],
  ['bg', 'Tło planszy', 'Kwadratowa plansza, obrazek wypełnia ją całą (przycięty jak tapeta). Pod nim kolor tła.'],
];

export default function GamesAdmin() {
  const [look, setLook] = useState<Look | null>(null);
  const [color, setColor] = useState('#4ade80');
  const [bg, setBg] = useState('#0d130f');
  const [busy, setBusy] = useState(false);
  const [reward, setReward] = useState<Record<string, string>>({});
  const [run, setRun] = useState<Record<string, string>>({});
  const applyRun = (r: RunReward) => setRun(Object.fromEntries(RUN_FIELDS.map(([k]) => [k, String(r[k])])));
  useEffect(() => { api<{ reward: RunReward }>('/api/admin/run').then(d => applyRun(d.reward)).catch(e => toast(e.message, true)); }, []);
  const saveRun = async () => {
    setBusy(true);
    try { applyRun((await api<{ reward: RunReward }>('/api/admin/run', Object.fromEntries(RUN_FIELDS.map(([k]) => [k, +(run[k] || 0)])))).reward); toast('Nagroda Super Turbo Run zapisana'); }
    catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const apply = (l: Look) => {
    setLook(l); setColor(l.color); setBg(l.background);
    setReward(Object.fromEntries(REWARD_FIELDS.map(([k]) => [k, String(l.reward[k])])));
  };
  useEffect(() => { api<Look>('/api/games/snake').then(apply).catch(e => toast(e.message, true)); }, []);

  const send = async (form: FormData, msg: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/snake', { method: 'POST', body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error || 'Błąd serwera');
      apply(data);
      toast(msg);
    } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const saveColors = () => { const f = new FormData(); f.append('color', color); f.append('background', bg); send(f, 'Kolory zapisane'); };
  const reset = () => { const f = new FormData(); f.append('reset', '1'); send(f, 'Przywrócono domyślne kolory'); };
  const upload = (slot: string, file?: File) => {
    if (!file) return;
    if (file.type && file.type !== 'image/png') return toast('Tylko pliki PNG', true);
    const f = new FormData(); f.append(slot, file); send(f, 'Obrazek zapisany');
  };
  const saveReward = () => { const f = new FormData(); REWARD_FIELDS.forEach(([k]) => f.append(k, reward[k] ?? '0')); send(f, 'Nagroda zapisana'); };
  const addSounds = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const f = new FormData(); f.append('sound', file);
      await send(f, `Dodano dźwięk: ${file.name}`);
    }
  };
  const removeSound = (id: string) => { const f = new FormData(); f.append('removeSound', id); send(f, 'Dźwięk usunięty'); };
  const remove = (slot: string) => { if (!confirm('Usunąć ten obrazek? Gra wróci do rysowania go sama.')) return; const f = new FormData(); f.append('remove', slot); send(f, 'Obrazek usunięty'); };

  if (!look) return <p className="muted">Wczytywanie…</p>;
  return (
    <section className={s.box}>
      <div className="panel">
        <h3>Snake: kolory</h3>
        <p className="muted small">Kolor węża (głowa jaśniejsza, ogon ciemniejszy) i kolor tła planszy. Gracze zobaczą zmianę po wejściu do gry.</p>
        <div className={s.colors}>
          <label>Kolor węża<span><input type="color" value={color} onChange={e => setColor(e.target.value)} /><code>{color}</code></span></label>
          <label>Kolor tła<span><input type="color" value={bg} onChange={e => setBg(e.target.value)} /><code>{bg}</code></span></label>
          <div className={s.preview} style={{ background: bg }} aria-hidden="true">
            {[0, 1, 2, 3].map(i => <i key={i} style={{ background: color, opacity: 1 - i * .18 }} />)}
          </div>
        </div>
        <div className={s.btns}>
          <Button kind="hue" disabled={busy} onClick={saveColors}>Zapisz kolory</Button>
          <Button disabled={busy} onClick={reset}>Domyślne ({look.defaults.color} / {look.defaults.background})</Button>
        </div>
      </div>
      <div className="panel">
        <h3>Snake: obrazki PNG</h3>
        <p className="muted small">Każdy obrazek jest opcjonalny: bez niego gra rysuje ten element sama. Tylko pliki PNG (do 8 MB).</p>
        <div className={s.slots}>
          {SLOTS.map(([slot, name, hint]) => (
            <div key={slot} className={s.slot}>
              <div className={s.img} style={{ background: bg }}>{look.images[slot] ? <img src={look.images[slot]!} alt={name} /> : <span className="muted small">brak</span>}</div>
              <div>
                <b>{name}</b>
                <p className="muted small">{hint}</p>
                <div className={s.btns}>
                  <label className={`btn ${s.file}`}>Wgraj PNG<input type="file" accept="image/png" disabled={busy} onChange={e => { upload(slot, e.target.files?.[0]); e.target.value = ''; }} /></label>
                  {look.images[slot] && <Button disabled={busy} onClick={() => remove(slot)}>Usuń</Button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>Snake: dźwięki jabłka</h3>
        <p className="muted small">Przy każdym zjedzonym jabłku gra losuje jeden z tych dźwięków (głośność z ustawień gracza). Bez dźwięków gra wydaje
          własne piknięcie. Najwyżej {look.maxSounds} plików MP3, OGG albo WAV, do 2 MB każdy — najlepiej krótkie, poniżej sekundy.</p>
        <ul className={s.sounds}>
          {look.sounds.map((snd, i) => (
            <li key={snd.id}>
              <b>Dźwięk {i + 1}</b>
              <audio controls preload="none" src={snd.url} />
              <Button disabled={busy} onClick={() => { if (confirm('Usunąć ten dźwięk?')) removeSound(snd.id); }}>Usuń</Button>
            </li>
          ))}
          {look.sounds.length === 0 && <li className="muted small">Nie ma jeszcze żadnego dźwięku.</li>}
        </ul>
        <div className={s.btns}>
          <label className={`btn ${s.file}`} aria-disabled={busy || look.sounds.length >= look.maxSounds}>
            Dodaj dźwięki ({look.sounds.length} / {look.maxSounds})
            <input type="file" accept="audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav" multiple disabled={busy || look.sounds.length >= look.maxSounds}
              onChange={e => { addSounds(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
      </div>
      <div className="panel">
        <h3>Snake: nagroda w groszach</h3>
        <p className="muted small">Po skończonej grze gracz dostaje grosze za jabłka: od podanej liczby jabłek, z limitem na jedną grę i na dzień.
          Wynik liczy przeglądarka, więc serwer odrzuca wyniki niemożliwe w czasie gry, a limit dzienny ogranicza ewentualne oszustwa.
          0 groszy za jabłko albo 0 na dzień = bez nagród.</p>
        <div className={s.reward}>
          {REWARD_FIELDS.map(([k, label, unit]) => (
            <label key={k}>{label}
              <span><input type="number" min={0} step={1} value={reward[k] ?? ''} onChange={e => setReward(r => ({ ...r, [k]: e.target.value }))} /> {unit}</span>
            </label>
          ))}
        </div>
        <p className="muted small">Przykład: {reward.perApple || 0} gr × 30 jabłek = {Math.min(+(reward.perApple || 0) * 30, +(reward.perGame || 0))} gr
          {30 < +(reward.minScore || 0) ? ' (za mało jabłek - 0 gr)' : ''}.</p>
        <p className="muted small">Karty w wariancie Pikselowa za wynik w zwykłym Snake'u (2D) dostaje się od progów jabłek z game.json (<code>snake.cardTiers</code>), bez limitu kart na dobę. Snake 3D (Super Turbo) daje zamiast Pikselowej kartę RGB.</p>
        <div className={s.btns}><Button kind="hue" disabled={busy} onClick={saveReward}>Zapisz nagrodę</Button></div>
      </div>
      <div className="panel">
        <h3>Gry Super Turbo: nagroda w groszach i karty RGB</h3>
        <p className="muted small">Po skończonym biegu gracz dostaje grosze za przebiegnięty dystans: od podanej liczby metrów, z limitem na jedną grę i na dzień. Serwer
          odrzuca dystans niemożliwy w czasie od startu gry. 0 groszy za 100 m albo 0 na dzień = bez nagród. Pola grosza dotyczą Super Turbo Run; Snake 3D płaci wg ustawień Snake'a. Za wysoki wynik (Run: dystans, Snake 3D: jabłka) wypada karta w wariancie Gamingowa RGB, progi w game.json (<code>turbo.runTiers</code> i <code>turbo.snakeTiers</code>), bez limitu kart na dobę.</p>
        <div className={s.reward}>
          {RUN_FIELDS.map(([k, label, unit]) => (
            <label key={k}>{label}
              <span><input type="number" min={0} step={1} value={run[k] ?? ''} onChange={e => setRun(r => ({ ...r, [k]: e.target.value }))} /> {unit}</span>
            </label>
          ))}
        </div>
        <p className="muted small">Przykład: 1000 m = {Math.min(Math.floor(1000 * +(run.per100m || 0) / 100), +(run.perGame || 0))} gr{1000 < +(run.minDist || 0) ? ' (za krótko - 0 gr)' : ''}.</p>
        <div className={s.btns}><Button kind="hue" disabled={busy} onClick={saveRun}>Zapisz nagrodę</Button></div>
      </div>
    </section>
  );
}
