import { useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import s from './legal.module.css';

/** Okienko dla gracza, który nie zaakceptował aktualnej wersji regulaminu (po zmianie regulaminu). Nie da się go zamknąć bez wyboru. */
export function TermsDialog({ onDone }: { onDone: () => void }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try { await api('/api/terms/accept', {}); onDone(); }
    catch (e: any) { toast(e.message, true); setBusy(false); }
  };
  const leave = async () => {
    await api('/api/logout', {}).catch(() => {});
    location.href = '/login';
  };

  return (
    <Modal title="Zmiany w regulaminie" onClose={() => {}}>
      <p>Zaktualizowaliśmy <a href="/regulamin" target="_blank" rel="noopener">Regulamin</a> i <a href="/prywatnosc" target="_blank" rel="noopener">Politykę prywatności</a>. Żeby grać dalej, zapoznaj się z nimi i je zaakceptuj.</p>
      <label className={`${s.check}`}>
        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
        <span>Akceptuję Regulamin i Politykę prywatności.</span>
      </label>
      <div className={s.actions}>
        <Button kind="hue" disabled={!agree || busy} onClick={accept}>Akceptuję i gram dalej</Button>
        <Button onClick={leave}>Wyloguj</Button>
      </div>
    </Modal>
  );
}
