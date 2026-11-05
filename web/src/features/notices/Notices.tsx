import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { S, touch, useGame } from '../../game/store';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { DailyDialog } from '../daily/DailyDialog';
import { TermsDialog } from '../legal/TermsDialog';
import styles from './Notices.module.css';

// Okienka gry pokazywane jedno po drugim: wiadomości od adminów, lista zmian, codzienna skrzynka.
type Notice = { kind: 'messages'; list: any[] } | { kind: 'patch'; notes: any[] } | { kind: 'daily' } | { kind: 'terms' };

const seenMessages = new Set<number>();

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
  if (me.patchNotes?.length) queueNotice({ kind: 'patch', notes: me.patchNotes });
  if (me.dailyClaimable) queueNotice({ kind: 'daily' });
}

function Messages({ list, onClose }: { list: any[]; onClose: () => void }) {
  useEffect(() => { api('/api/messages/seen', { ids: list.map(m => m.id) }).catch(() => {}); }, [list]);
  return (
    <Modal title={list.length > 1 ? 'Wiadomości od ScamBox' : 'Wiadomość od ScamBox'} onClose={onClose}>
      {list.map(m => (
        <article key={m.id} className={styles.note}>
          <header><b>{m.title}</b><span className="muted small">{new Date(m.at * 1000).toLocaleDateString('pl-PL')}</span></header>
          <p>{m.body}</p>
        </article>
      ))}
      <Button kind="hue" onClick={onClose}>OK</Button>
    </Modal>
  );
}

export function PatchNotes({ notes, onClose }: { notes: any[]; onClose: () => void }) {
  useEffect(() => { api('/api/patchnotes/seen', {}).catch(() => {}); }, []);
  return (
    <Modal title="Co nowego w ScamBox" onClose={onClose} wide>
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
  return <DailyDialog onClose={close} />;
}
