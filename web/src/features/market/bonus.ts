// Premia z rynku: kupujący dostaje Paragon (wychodzi z drukarki), sprzedający kartę w metalu
import { receiptReveal } from '../../fx/effects';
import { person, variantName } from '../../game/rules';
import { refreshConfig } from '../../game/session';
import { S, touch } from '../../game/store';
import { sleep } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import { animBusy } from '../achievements/popups';

const printer = { queue: [] as any[], busy: false };

async function printNext() {
  if (printer.busy) return;
  printer.busy = true;
  while (printer.queue.length) {
    while (animBusy()) await sleep(300);   // nie przerywamy bębna ani innej animacji
    const item = printer.queue.shift();
    if (person(item.person)?.masked) await refreshConfig();
    await receiptReveal(item);
  }
  printer.busy = false;
}

export function noteMarketBonus(list: any[] | undefined) {
  if (!list?.length) return;
  const items = list.map(b => b.item).filter(i => i && !S.items.some(x => x.id === i.id));
  if (items.length) {
    S.items = [...items, ...S.items].sort((a, b) => b.id - a.id);
    items.forEach(i => S.collected.add(`${i.person}|${i.variant}`));
    touch();
  }
  list.forEach(b => {
    const name = person(b.personId)?.name || 'karta';
    if (b.role === 'buyer' && b.item) { printer.queue.push(b.item); return; }
    toast(b.role === 'buyer' ? `Premia z rynku: do kupionej karty dostajesz ${name} w wariancie ${variantName(b.variant)}` : `Premia za sprzedaż: dostajesz ${name} w wariancie ${variantName(b.variant)}`);
    Sound.win();
  });
  printNext();
}
