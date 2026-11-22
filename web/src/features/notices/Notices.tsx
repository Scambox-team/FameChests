import { useCallback, useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { syncInventory } from '../../game/session';
import { Sound } from '../../sound/sound';
import { Avatar } from '../../ui/UserLink';
import { api } from '../../api/client';
import { S, touch, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { DailyDialog } from '../daily/DailyDialog';
import { TermsDialog } from '../legal/TermsDialog';
import styles from './Notices.module.css';

// Okienka gry pokazywane jedno po drugim: wiadomości od adminów, lista zmian, codzienna skrzynka.
// Wiadomości, lista zmian i nagrody za polecenia mają u góry obrazek: własne zdjęcie wiadomości (panel admina) albo domyślny.
type Notice = { kind: 'messages'; list: any[] } | { kind: 'patch'; notes: any[] } | { kind: 'daily' } | { kind: 'terms' } | { kind: 'referral'; list: any[] } | { kind: 'christmas'; note: any };

const seenMessages = new Set<number>();
const DEFAULT_IMAGE = '/static/img/notice-default.webp';

/** Obrazek u góry okienka */
function Banner({ src }: { src?: string | null }) {
  return <img className={styles.banner} src={src || DEFAULT_IMAGE} alt="" loading="eager" />;
}
const seenReferrals = new Set<string>();

/** Nagrody za polecenia (reflinki) z /api/me: okienko raz na nagrodę */
export function showReferral(list: any[] = []) {
  const fresh = list.filter(n => !seenReferrals.has(`${n.role}:${n.referredId}`));
  if (!fresh.length) return;
  fresh.forEach(n => seenReferrals.add(`${n.role}:${n.referredId}`));
  queueNotice({ kind: 'referral', list: fresh });
}

let christmasQueued = false;

/** Wynik wspólnej choinki z /api/me: okienko raz (nagrody po evencie świątecznym) */
export function showChristmas(note: any) {
  if (!note || christmasQueued) return;
  christmasQueued = true;
  queueNotice({ kind: 'christmas', note });
}

export function queueNotice(n: Notice) {
  S.notices = [...(S.notices ?? []), n];
  touch();
}

let termsQueued = false;

/** Nowa wersja regulaminu: okienko z akceptacją idzie przed wszystkimi innymi i czeka, aż gracz wybierze */
export function showTerms(me: any) {
  if (!me.needsTerms || termsQueued) return;
  termsQueued = true;
  S.notices = [{ kind: 'terms' }, ...(S.notices ?? [])];
  touch();
}

export function showMessages(list: any[] = []) {
  const fresh = list.filter(m => !seenMessages.has(m.id));
  if (!fresh.length || S.opening) return;
  fresh.forEach(m => seenMessages.add(m.id));
  queueNotice({ kind: 'messages', list: fresh });
}

/** Okienka na start gry, w tej samej kolejności co zawsze */
export function startNotices(me: any) {
  showTerms(me);
  showMessages(me.messages);
  showReferral(me.referral);
  showChristmas(me.christmas);
  if (me.patchNotes?.length) queueNotice({ kind: 'patch', notes: me.patchNotes });
  if (me.dailyClaimable) queueNotice({ kind: 'daily' });
}

function Messages({ list, onClose }: { list: any[]; onClose: () => void }) {
  useEffect(() => { api('/api/messages/seen', { ids: list.map(m => m.id) }).catch(() => {}); }, [list]);
  return (
    <Modal title={list.length > 1 ? 'Wiadomości od ScamBox' : 'Wiadomość od ScamBox'} onClose={onClose}>
      <Banner src={list[0]?.image} />
      {list.map((m, i) => (
        <article key={m.id} className={styles.note}>
          {i > 0 && m.image && <Banner src={m.image} />}
          <header><b>{m.title}</b><span className="muted small">{new Date(m.at * 1000).toLocaleDateString('pl-PL')}</span></header>
          <p>{m.body}</p>
        </article>
      ))}
      <Button kind="hue" onClick={onClose}>OK</Button>
    </Modal>
  );
}

function Referral({ list, onClose }: { list: any[]; onClose: () => void }) {
  useEffect(() => {
    Sound.win();
    api('/api/referral/seen', { ids: list.map(n => n.referredId) }).catch(() => {});
    syncInventory(null, true);   // skrzynki i grosze z nagrody
  }, [list]);
  return (
    <Modal title="Nagroda za polecenie" onClose={onClose}>
      <Banner />
      {list.map(n => (
        <article key={`${n.role}:${n.referredId}`} className={styles.note}>
          <header><b><Gift size={16} aria-hidden="true" /> {n.role === 'referrer' ? 'Twój znajomy dołączył do gry' : 'Witamy z polecenia'}</b></header>
          <p>{n.other && <Avatar user={n.other} size={20} />} {n.role === 'referrer'
            ? <>Gracz <b>{n.other?.username}</b> założył konto z twojego linku i zaczął grać. Dostajesz: <b>{n.reward}</b>.</>
            : <>Twoje konto powstało z polecenia gracza <b>{n.other?.username}</b>. Dostajesz: <b>{n.reward}</b>.</>}</p>
        </article>
      ))}
      <p className="muted small">Skrzynki czekają w ekwipunku.</p>
      <Button kind="hue" onClick={onClose}>Super</Button>
    </Modal>
  );
}

function Christmas({ note, onClose }: { note: any; onClose: () => void }) {
  useEffect(() => {
    Sound.win();
    api('/api/christmas/seen', {}).catch(() => {});
    syncInventory(null, true);   // karty z puli i zwrot
  }, [note]);
  const rewards: any[] = note.rewards || [];
  return (
    <Modal title="Choinka rozliczona" onClose={onClose}>
      <Banner />
      <article className={styles.note}>
        <header><b><Gift size={16} aria-hidden="true" /> Dziękujemy za udekorowanie choinki</b></header>
        <p>Powiesiłeś {note.hung} {note.hung === 1 ? 'kartę' : 'kart'} o wartości {fmt(note.value)}. Za to dostajesz {rewards.length} {rewards.length === 1 ? 'kartę' : 'kart'} świątecznych o wartości {fmt(note.rewardsValue)} oraz {(note.pool || []).length} {(note.pool || []).length === 1 ? 'kartę' : 'kart'} z puli choinki o wartości {fmt(note.poolValue || 0)}.</p>
        {(note.pool || []).length > 0 && <><p className="muted small">Z puli (karty innych graczy):</p><ul>{note.pool.slice(0, 8).map((r: any, i: number) => <li key={i}><b>{r.name}</b> ({r.variantName}) od {r.from}</li>)}{note.pool.length > 8 && <li>… i {note.pool.length - 8} więcej</li>}</ul></>}
        {rewards.length > 0 && <><p className="muted small">Karty świąteczne:</p><ul>{rewards.slice(0, 8).map((r, i) => <li key={i}><b>{r.name}</b> ({r.variantName}){r.special ? ' · specjalna' : ''}</li>)}{rewards.length > 8 && <li>… i {rewards.length - 8} więcej</li>}</ul></>}
      </article>
      <Button kind="hue" onClick={onClose}>Super</Button>
    </Modal>
  );
}

export function PatchNotes({ notes, onClose }: { notes: any[]; onClose: () => void }) {
  useEffect(() => { api('/api/patchnotes/seen', {}).catch(() => {}); }, []);
  return (
    <Modal title="Co nowego w ScamBox" onClose={onClose} wide>
      <Banner />
      {notes.map((n, i) => (
        <article key={i} className={styles.note}>
          <header><b>{n.title}</b><span className="muted small">{new Date(n.date).toLocaleDateString('pl-PL')}</span></header>
          <ul>{n.items.map((t: string, k: number) => <li key={k} dangerouslySetInnerHTML={{ __html: t }} />)}</ul>
        </article>
      ))}
      <Button kind="hue" onClick={onClose}>Gramy</Button>
    </Modal>
  );
}

export function Notices() {
  const game = useGame();
  const [manualDaily, setManualDaily] = useState(false);
  const next = game.notices?.[0] as Notice | undefined;
  const close = useCallback(() => { S.notices = (S.notices ?? []).slice(1); touch(); }, []);

  useEffect(() => { S.openDaily = () => { if (!S.opening) setManualDaily(true); }; return () => { S.openDaily = null; }; }, []);

  if (manualDaily) return <DailyDialog onClose={() => setManualDaily(false)} />;
  if (!next || game.opening) return null;
  if (next.kind === 'terms') return <TermsDialog onDone={() => { termsQueued = false; close(); }} />;
  if (next.kind === 'messages') return <Messages list={next.list} onClose={close} />;
  if (next.kind === 'patch') return <PatchNotes notes={next.notes} onClose={close} />;
  if (next.kind === 'referral') return <Referral list={next.list} onClose={close} />;
  if (next.kind === 'christmas') return <Christmas note={next.note} onClose={() => { christmasQueued = false; close(); }} />;
  return <DailyDialog onClose={close} />;
}
