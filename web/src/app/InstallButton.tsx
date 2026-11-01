import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Sound } from '../sound/sound';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/Toaster';

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Instalacja gry jako aplikacji: Android, Chrome i Edge same to proponują, a na iPhonie pokazujemy instrukcję */
export function InstallButton({ className }: { className?: string }) {
  const prompt = useRef<any>(null);
  const [show, setShow] = useState(() => !isStandalone() && isIOS());
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const ready = (e: Event) => { e.preventDefault(); prompt.current = e; setShow(true); };
    const done = () => { prompt.current = null; setShow(false); toast('Gotowe, gra jest na ekranie głównym'); };
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', ready); window.removeEventListener('appinstalled', done); };
  }, []);
  if (!show) return null;

  const click = async () => {
    Sound.click();
    if (!prompt.current) return setHelp(true);
    prompt.current.prompt();
    const { outcome } = await prompt.current.userChoice;
    if (outcome === 'accepted') { prompt.current = null; setShow(false); }
  };
  return (
    <>
      <button className={className} type="button" title="Zainstaluj grę jako aplikację" aria-label="Zainstaluj grę jako aplikację" onClick={click}><Download size={17} strokeWidth={1.6} /></button>
      {help && <Modal title="Gra jako aplikacja" onClose={() => setHelp(false)}>
        {isIOS() ? <ol><li>Otwórz grę w <b>Safari</b>.</li><li>Stuknij <b>Udostępnij</b> na dole ekranu.</li><li>Wybierz <b>„Do ekranu początkowego”</b> i stuknij <b>Dodaj</b>.</li></ol>
          : <ol><li>Otwórz menu przeglądarki.</li><li>Wybierz <b>„Zainstaluj aplikację”</b> albo <b>„Dodaj do ekranu głównego”</b>.</li></ol>}
        <p className="muted">Gra pojawi się z ikoną na ekranie telefonu i otworzy się na pełnym ekranie, bez paska przeglądarki.</p>
        <Button onClick={() => setHelp(false)}>Zamknij</Button>
      </Modal>}
    </>
  );
}
