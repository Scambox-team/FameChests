// Przyciski „Pokaż znajomym” i „Do gabloty” w podglądzie karty oraz edytory czystej kartki i zdrapki
import { api } from '../../api/client';
import { setFavorite } from '../../game/actions';
import { closeViewer, viewerActions } from '../../fx/effects';
import { S, touch } from '../../game/store';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import { openDrawing } from '../editors/drawing';
import { openScratch } from '../editors/scratch';

const myItemFor = (pid: string, variant: string) => S.items.find(i => i.person === pid && i.variant === variant);

const showcaseHas = (pid: string, variant: string) => S.showcase.some(id => {
  const it = S.items.find(i => i.id === id);
  return it && it.person === pid && it.variant === variant;
});

async function toggleShowcase(pid: string, variant: string) {
  let ids = S.showcase.filter(id => S.items.some(i => i.id === id));
  const inside = ids.find(id => { const it = S.items.find(i => i.id === id)!; return it.person === pid && it.variant === variant; });
  if (inside) ids = ids.filter(id => id !== inside);
  else {
    if (ids.length >= S.cfg.showcaseSize) return toast(`Gablota mieści ${S.cfg.showcaseSize} kart. Najpierw coś z niej zdejmij.`, true);
    ids.push(myItemFor(pid, variant)!.id);
  }
  try {
    const res = await api('/api/showcase', { ids });
    S.showcase = res.showcase;
    Sound.click();
    toast(inside ? 'Zdjęto z gabloty' : 'Dodano do gabloty na twoim profilu');
    touch();
  } catch (e: any) { toast(e.message, true); }
}

// ulubiona z podglądu karty: konkretny egzemplarz (gdy podgląd ma numer), inaczej wszystkie moje egzemplarze tej karty w tym wariancie
const favTargets = (pid: string, variant: string, uid?: string | number | null) => {
  const one = uid != null ? S.items.find(i => i.id === +uid && i.person === pid) : null;
  return one ? [one] : S.items.filter(i => i.person === pid && i.variant === variant);
};
const isFavorite = (pid: string, variant: string, uid?: string | number | null) => {
  const list = favTargets(pid, variant, uid);
  return list.length > 0 && list.every(i => i.fav);
};
async function toggleFavorite(pid: string, variant: string, uid?: string | number | null) {
  const list = favTargets(pid, variant, uid);
  if (!list.length) return;
  const fav = !list.every(i => i.fav);
  try {
    await setFavorite(list.map(i => i.id), fav);
    toast(fav ? (list.length > 1 ? `Dodano do ulubionych (${list.length})` : 'Dodano do ulubionych') : 'Usunięto z ulubionych');
  } catch (e: any) { toast(e.message, true); }
}

export function installViewerActions() {
  Object.assign(viewerActions, {
    myItemFor, showcaseHas, toggleShowcase, openDrawing, openScratch, isFavorite, toggleFavorite,
    openReport(pid: string, variant: string) {
      closeViewer();
      S.reportCard = { pid, variant };
      touch();
    },
    openShowDialog(pid: string, variant: string) {
      if (!myItemFor(pid, variant)) return toast('Nie masz tej karty', true);
      closeViewer();
      S.shareCard = { pid, variant };
      touch();
    }
  });
}
