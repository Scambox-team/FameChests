import { useMemo } from 'react';
import { crateOf } from '../../game/rules';
import { S, useGame } from '../../game/store';
import { Button } from '../../ui/Button';
import { CrateArt, MoneyChestArt } from '../crates/CrateArt';
import { moneyLook3d } from '../crates/crateLook';
import { openCrates } from '../crates/opening';
import { openMoneyChest } from '../daily/moneyChest';
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
        const crate = crateOf(kind);
        if (!money && !crate) return null;
        const max = Math.min(n, cfg.maxOpen);
        return (
          <div key={kind} className={styles.chest}>
            {money ? <MoneyChestArt look={moneyLook3d(money)} className={styles.chestArt} /> : <CrateArt crate={crate} className={styles.chestArt} />}
            <span className={styles.chestText}><b>{(money ?? crate).name}</b><span className="muted small">×{n} · {money ? `${money.min.toLocaleString('pl-PL')}–${money.max.toLocaleString('pl-PL')} gr` : `${crate.people.length} kart`}</span></span>
            {money
              ? <Button kind="hue" onClick={() => openMoneyChest(kind.slice(6))}>Otwórz</Button>
              : <><Button kind="hue" onClick={() => open(kind, 1)}>Otwórz</Button>{n > 1 && <Button onClick={() => open(kind, max)}>×{max}</Button>}</>}
          </div>
        );
      })}
    </section>
  );
}
