import { useMemo } from 'react';
import { crateOf } from '../../game/rules';
import { S, useGame } from '../../game/store';
import { Button } from '../../ui/Button';
import { CrateArt, MoneyChestArt } from '../crates/CrateArt';
import { moneyLook3d } from '../crates/crateLook';
import { openCrates } from '../crates/opening';
import { openMoneyChest } from '../daily/moneyChest';
import { openStickerCrate } from '../stickers/stickers';
import { toast } from '../../ui/Toaster';
import styles from './InventoryPage.module.css';

/** Skrzynki czekające w ekwipunku, pieniężne na początku */
export function ChestShelf() {
  const { chests, cfg } = useGame();
  const kinds = useMemo(() => Object.entries(chests).filter(([, n]) => n > 0)
    .sort(([a], [b]) => (Number(b.startsWith('money_')) - Number(a.startsWith('money_'))) || a.localeCompare(b)), [chests]);
  if (!kinds.length) return null;
  const open = (id: string, n: number) => { S.crate = id; S.count = n; openCrates(); };
  return (
    <section className={styles.shelf} aria-label="Twoje skrzynki">
      {kinds.map(([kind, n]) => {
        const money = kind.startsWith('money_') ? cfg.moneyChests[kind.slice(6)] : null;
        // skrzynka z naklejkami (rodzaj sticker_<id>): rysowana jak skrzynka z kartami, otwierana w oknie z naklejkami
        const stk = kind.startsWith('sticker_') ? cfg.stickerCrates?.find((c: any) => c.kind === kind) : null;
        const crate = stk ? { id: kind, name: stk.name, short: stk.name, code: 'NK', desc: stk.desc, emoji: stk.emoji, price: 0, color1: stk.color1, color2: stk.color2, shop: false, canBuy: false, people: [], weights: {} } : crateOf(kind);
        if (!money && !crate) return null;
        const max = Math.min(n, cfg.maxOpen);
        const openStk = (count: number) => openStickerCrate(stk.id, count).catch((e: any) => toast(e.message, true));
        return (
          <div key={kind} className={styles.chest}>
            {money ? <MoneyChestArt look={moneyLook3d(money)} className={styles.chestArt} /> : <CrateArt crate={crate} className={styles.chestArt} />}
            <span className={styles.chestText}><b>{(money ?? crate).name}</b><span className="muted small">×{n} · {money ? `${money.min.toLocaleString('pl-PL')}–${money.max.toLocaleString('pl-PL')} gr` : stk ? 'naklejki' : `${crate.people.length} kart`}</span></span>
            {money
              ? <Button kind="hue" onClick={() => openMoneyChest(kind.slice(6))}>Otwórz</Button>
              : stk ? <><Button kind="hue" onClick={() => openStk(1)}>Otwórz</Button>{n > 1 && <Button onClick={() => openStk(max)}>×{max}</Button>}</>
              : <><Button kind="hue" onClick={() => open(kind, 1)}>Otwórz</Button>{n > 1 && <Button onClick={() => open(kind, max)}>×{max}</Button>}</>}
          </div>
        );
      })}
    </section>
  );
}
