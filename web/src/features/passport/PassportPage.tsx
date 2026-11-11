import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, MapPin, ShieldCheck, Smartphone, Stamp as StampIcon, Users } from 'lucide-react';
import { api } from '../../api/client';
import { lang } from '../../i18n/i18n';
import { applyState, syncInventory } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import { fmtNum } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { PageHero } from '../../ui/PageHero';
import { UserLink, type UserRef } from '../../ui/UserLink';
import { ALL_COUNTRIES, BY_CODE, countryName, Stamp, StampDefs, type Country } from './Stamp';
import s from './passport.module.css';

// Paszport: stempel za każde państwo, z którego gracz wszedł do gry. Kraj ustala serwer z pozycji GPS wysłanej tylko po kliknięciu
// (współrzędne nie są zapisywane); GPS jest opcjonalny - bez niego gra działa tak samo, brakuje tylko stempli.

const CONTINENTS: [string, string][] = [
  ['eu', 'Europa'], ['as', 'Azja'], ['af', 'Afryka'], ['na', 'Ameryka Północna'], ['sa', 'Ameryka Południowa'], ['oc', 'Australia i Oceania']
];

interface PassportData { stamps: { c: string; at: number }[]; holders: Record<string, number>; style: Record<string, { color?: string; icon?: number }>; total: number }
interface Reward { text: string }
interface Holders { code: string; total: number; reward: Reward[]; users: { user: UserRef & { id: number }; at: number; me: boolean }[] }
type Note = { kind: 'ok' | 'info' | 'err'; text: string };

/** Pozycja z przeglądarki jako obietnica; błędy zamieniamy na czytelny polski komunikat */
function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(new Error('Lokalizacja działa tylko na bezpiecznym połączeniu (https).'));
    if (!('geolocation' in navigator)) return reject(new Error('Ta przeglądarka nie obsługuje lokalizacji.'));
    // prosty bezpiecznik: skrypt (np. wklejony do konsoli) podmieniający funkcję lokalizacji nie jest już funkcją natywną.
    // Serwer i tak sprawdza resztę (czas dotarcia, dzienny limit), bo ten test da się obejść.
    if (!Function.prototype.toString.call(navigator.geolocation.getCurrentPosition).includes('[native code]')) {
      return reject(new Error('Wykryto podmienioną lokalizację przeglądarki. Stempel zostanie przyznany tylko za prawdziwą pozycję z urządzenia.'));
    }
    navigator.geolocation.getCurrentPosition(resolve, e => {
      reject(new Error(e.code === e.PERMISSION_DENIED
        ? 'Odmówiono dostępu do lokalizacji. Zezwól na nią w ustawieniach przeglądarki albo pomiń Paszport: gra działa bez niego.'
        : e.code === e.TIMEOUT
          ? 'Ustalanie pozycji trwało zbyt długo. Włącz GPS, wyjdź w miejsce z widokiem na niebo i spróbuj ponownie.'
          : 'Nie udało się ustalić pozycji. Włącz GPS (albo Wi-Fi) w urządzeniu i spróbuj ponownie.'));
    }, { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
  });
}

/** Pozycja bardziej niedokładna niż to (w metrach) nie jest wysyłana: mogłaby wskazać sąsiednie państwo */
const MAX_ACCURACY = 20000;

const when = (t: number) => new Date(t * 1000).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });

export function PassportPage() {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['passport'], queryFn: () => api<PassportData>('/api/passport') });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [open, setOpen] = useState<Country | null>(null);
  const game = useGame();
  // zwykli gracze przy każdym wejściu dostają informację, że Paszport jest eksperymentalny (admini go testują, więc ich nie pytamy)
  const [notice, setNotice] = useState(true);
  const cells = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => { document.title = 'Paszport · ScamBox'; }, []);

  const mine = useMemo(() => new Map((data?.stamps ?? []).map(x => [x.c, x.at])), [data]);
  // wygląd z panelu admina (kolor, własna ikona) nałożony na tabelę państw
  const countries = useMemo(() => ALL_COUNTRIES.map(c => {
    const st = data?.style?.[c.c];
    return st ? { ...c, col: st.color || c.col, icon: st.icon ? `/passport/icon/${c.c}?v=${st.icon}` : undefined } : c;
  }), [data]);
  const sorted = useMemo(() => {
    const by = new Map<string, Country[]>();
    for (const c of countries) by.set(c.k, [...(by.get(c.k) ?? []), c]);
    for (const list of by.values()) list.sort((a, b) => countryName(a).localeCompare(countryName(b), lang));
    return by;
  }, [countries]);

  const locate = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const pos = await position();
      if (pos.coords.accuracy > MAX_ACCURACY) {
        setNote({ kind: 'err', text: `Pozycja jest zbyt niedokładna (±${Math.round(pos.coords.accuracy / 1000)} km). Włącz GPS albo spróbuj na telefonie.` });
        return;
      }
      const r = await api<{ country: string | null; new?: boolean; rewards?: Reward[]; state?: any; chests?: Record<string, number>; blocked?: 'accuracy' | 'travel' | 'daily'; from?: string; waitMinutes?: number; limit?: number }>('/api/passport/locate', { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy });
      const c = r.country ? BY_CODE[r.country] : null;
      if (r.blocked === 'accuracy') {
        setNote({ kind: 'err', text: 'Pozycja wygląda na nieprawdziwą (dokładność zero albo ponad 50 km). Włącz prawdziwy GPS i spróbuj ponownie.' });
      } else if (r.blocked === 'travel' && c) {
        const m = r.waitMinutes ?? 0, wait = m >= 60 ? `${Math.floor(m / 60)} godz. ${m % 60} min` : `${m} min`;
        setNote({ kind: 'err', text: `Za szybka zmiana miejsca: poprzednia lokalizacja to ${r.from && BY_CODE[r.from] ? countryName(BY_CODE[r.from]) : r.from}, a dotarcie stamtąd do kraju ${countryName(c)} zajmuje więcej czasu. Spróbuj ponownie za ${wait}.` });
      } else if (r.blocked === 'daily') {
        setNote({ kind: 'err', text: `Dzienny limit nowych stempli (${r.limit}) został wykorzystany. Spróbuj ponownie jutro.` });
      } else if (!c) {
        setNote({ kind: 'info', text: 'W tym miejscu nie ma państwa ze stemplem (morze albo obszar, którego Polska nie uznaje za państwo).' });
      } else if (r.new) {
        const won = r.rewards?.map(x => x.text).join(', ');
        setNote({ kind: 'ok', text: won ? `Nowy stempel: ${countryName(c)}. Nagroda: ${won}` : `Nowy stempel: ${countryName(c)}` });
        if (r.rewards?.length) {
          if (r.state) applyState(r.state);
          if (r.chests) S.chests = r.chests;
          touch();
          Sound.coin(2);
          syncInventory(null, true).catch(() => {});
        }
        setFresh(c.c);
        await qc.invalidateQueries({ queryKey: ['passport'] });
        setTimeout(() => cells.current[c.c]?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
      } else {
        setNote({ kind: 'info', text: `Masz już stempel: ${countryName(c)}` });
      }
    } catch (e) {
      setNote({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [qc]);

  if (error) return <p className="muted">{(error as Error).message}</p>;
  if (!data) return <p className="muted">Ładowanie</p>;

  const total = ALL_COUNTRIES.length;
  const lastCode = [...data.stamps].sort((a, b) => b.at - a.at)[0]?.c;
  return (
    <div className={`${s.page} ${s.ink}`}>
      <StampDefs />
      <PageHero icon={StampIcon} title="Paszport" lead="Zbieraj stemple państw, w których grasz w ScamBoxa. Jest ich tyle, ile państw uznaje Polska: członkowie ONZ, Kosowo, Palestyna i Watykan."
        stats={[['Stemple', `${data.stamps.length} z ${total}`], ['Państw łącznie', String(total)], ...(lastCode ? [['Ostatni stempel', countryName(BY_CODE[lastCode])] as [string, string]] : [])]} />

      <section className={s.gps} aria-labelledby="psp-gps">
        <div className={s.gpsText}>
          <h2 id="psp-gps"><MapPin size={20} aria-hidden="true" /> Zaznacz swoją lokalizację <span className={s.badge}>Opcjonalne</span></h2>
          <p><b>Żeby zdobywać stemple, musisz mieć włączony GPS</b> i zgodzić się na udostępnienie lokalizacji. Najlepiej działa na telefonie; na komputerze pozycja bywa przybliżona (z Wi-Fi albo adresu IP) i może nie wystarczyć.</p>
          <p className={s.opt}><Smartphone size={16} aria-hidden="true" /> To jest całkowicie dobrowolne: bez GPS grasz normalnie, nic nie tracisz poza stemplami.</p>
          <p className={s.opt}><ShieldCheck size={16} aria-hidden="true" /> Lokalizację wysyłamy tylko po kliknięciu przycisku, wyłącznie po to, by ustalić państwo. Zapisujemy sam kod państwa z datą; dokładnej pozycji nie zapisujemy ani nie pokazujemy nikomu.</p>
        </div>
        <div className={s.gpsAct}>
          <Button kind="hue" big disabled={busy} onClick={locate}><MapPin size={18} aria-hidden="true" /> {busy ? 'Ustalam lokalizację' : 'Zaznacz moją lokalizację'}</Button>
          {note && <p className={`${s.note} ${s[note.kind]}`} role="status">{note.text}</p>}
        </div>
      </section>

      {CONTINENTS.map(([k, label]) => {
        const list = sorted.get(k) ?? [];
        const got = list.filter(c => mine.has(c.c)).length;
        return (
          <section key={k} className={s.cont} aria-labelledby={`psp-${k}`}>
            <header className={s.contHead}>
              <h2 id={`psp-${k}`}>{label}</h2>
              <span className={s.count}>{got} / {list.length}</span>
              <span className={s.bar} aria-hidden="true"><i style={{ width: `${(got / Math.max(1, list.length)) * 100}%` }} /></span>
            </header>
            <div className={s.grid}>
              {list.map(c => {
                const has = mine.has(c.c), n = data.holders[c.c] ?? 0;
                return (
                  <button key={c.c} ref={el => { cells.current[c.c] = el; }} type="button" className={`${s.cell}${has ? ` ${s.got}` : ''}${fresh === c.c ? ` ${s.fresh}` : ''}`}
                    onClick={() => setOpen(c)} aria-label={`${countryName(c)}: ${has ? 'stempel zdobyty' : 'stempel niezdobyty'}`}>
                    <Stamp country={c} earned={has} className={s.stamp} />
                    <span className={s.meta}>{has ? <time dateTime={new Date(mine.get(c.c)! * 1000).toISOString()}>{when(mine.get(c.c)!)}</time> : <span>Niezdobyty</span>}</span>
                    <span className={s.who}><Users size={12} aria-hidden="true" /> {fmtNum(n)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {notice && !game.me?.isAdmin && (
        <Modal title="Funkcja eksperymentalna" onClose={() => setNotice(false)}>
          <p>Paszport jest funkcją eksperymentalną i nie jest jeszcze gotowy. Może działać niedokładnie, a stemple, nagrody i zasady ich zdobywania mogą się zmienić albo zostać wyzerowane.</p>
          <p className="muted">Korzystanie z niego jest dobrowolne: bez niego grasz normalnie.</p>
          <Button kind="hue" onClick={() => setNotice(false)}>Rozumiem</Button>
        </Modal>
      )}
      {open && <HoldersDialog country={countries.find(c => c.c === open.c) ?? open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Okno stempla: kto go zdobył i kiedy, od najwcześniejszego (bez graczy poza rankingiem; dokładnej lokalizacji nikt nie widzi) */
function HoldersDialog({ country, onClose }: { country: Country; onClose: () => void }) {
  const { data, error } = useQuery({ queryKey: ['passport', country.c], queryFn: () => api<Holders>(`/api/passport/${country.c}`) });
  return (
    <Modal title={countryName(country)} onClose={onClose}>
      <div className={s.ink}>
        <div className={s.dlgHead}>
          <Stamp country={country} earned className={s.dlgStamp} />
          <p className="muted">Gracze, którzy zdobyli ten stempel, w kolejności zdobycia.</p>
        </div>
        {data?.reward?.length ? <p className={s.reward}><Gift size={16} aria-hidden="true" /> {`Nagroda za stempel: ${data.reward.map(r => r.text).join(', ')}`}</p> : null}
        {error ? <p className="muted">{(error as Error).message}</p> : !data ? <p className="muted">Ładowanie</p>
          : data.users.length === 0 ? <p className="muted">Nikt jeszcze nie zdobył tego stempla. Możesz być pierwszy.</p>
          : (
            <ol className={s.holders}>
              {data.users.map((u, i) => (
                <li key={u.user.id} className={u.me ? s.holderMe : undefined}>
                  <span className={s.pos}>{i + 1}</span>
                  <span onClick={onClose}><UserLink user={u.user} /></span>
                  <time className={s.when} dateTime={new Date(u.at * 1000).toISOString()}>{when(u.at)}</time>
                </li>
              ))}
            </ol>
          )}
        {data && data.total > data.users.length && <p className="muted">{`Pokazano ${data.users.length} z ${data.total} graczy.`}</p>}
      </div>
    </Modal>
  );
}
