import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import s from './GamesAdmin.module.css';

// Zakładka panelu admina „Gry”: wygląd Snake'a (routes/snake.rs) - kolor węża i tła, obrazki PNG.
interface Look { color: string; background: string; defaults: { color: string; background: string }; images: Record<string, string | null> }
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
  const apply = (l: Look) => { setLook(l); setColor(l.color); setBg(l.background); };
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
    </section>
  );
}
