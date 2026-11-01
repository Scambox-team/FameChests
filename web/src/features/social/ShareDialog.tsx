import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { S, touch, useGame } from '../../game/store';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import s from './social.module.css';

/** „Pokaż znajomym” z podglądu karty: okno otwiera się nad dowolnym ekranem */
export function ShareDialog() {
  const { shareCard } = useGame();
  const [friends, setFriends] = useState<any[] | null>(null);
  const [to, setTo] = useState('all');
  const [message, setMessage] = useState('');
  const close = () => { S.shareCard = null; setFriends(null); setMessage(''); setTo('all'); touch(); };

  useEffect(() => {
    if (!shareCard) return;
    api('/api/friends').then(fr => {
      if (!fr.friends.length) { toast('Najpierw dodaj znajomych w zakładce Znajomi', true); return close(); }
      setFriends(fr.friends);
    }).catch(e => { toast(e.message, true); close(); });
  }, [shareCard]);
  if (!shareCard || !friends) return null;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const item = S.items.find(i => i.person === shareCard.pid && i.variant === shareCard.variant);
    if (!item) return close();
    try {
      await api('/api/show', { item_id: item.id, to, message });
      Sound.win();
      toast(to === 'all' ? 'Pokazano kartę znajomym' : `Pokazano kartę: ${to}`);
      close();
    } catch (err: any) { toast(err.message, true); }
  };
  return (
    <Modal title="Pokaż kartę znajomym" onClose={close}>
      <div className={s.share}>
        <Card person={shareCard.pid} variant={shareCard.variant} tilt={false} className={s.shareCard} />
        <form className={s.form} onSubmit={send}>
          <label>Komu?
            <Select value={to} onChange={e => setTo(e.target.value)}>
              <option value="all">Wszystkim znajomym</option>
              {friends.map(u => <option key={u.username} value={u.username}>{u.username}</option>)}
            </Select>
          </label>
          <label>Wiadomość (opcjonalnie)<input type="text" value={message} maxLength={140} placeholder="np. Patrz, co trafiłem" onChange={e => setMessage(e.target.value)} /></label>
          <div className={s.btns}><Button kind="hue" type="submit">Pokaż</Button><Button type="button" onClick={close}>Anuluj</Button></div>
        </form>
      </div>
    </Modal>
  );
}
