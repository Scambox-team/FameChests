import { Star } from 'lucide-react';
import { Card } from '../../cards/Card';
import { dupesOf, ownedMap, sellIds } from '../../game/actions';
import { cardValue, crateOf, isSpecialCard, person, variantName, vtClass } from '../../game/rules';
import { S, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import styles from './OwnedCardDialog.module.css';

/** Wszystkie egzemplarze jednej karty: sprzedaż pojedynczo, wariantami i duplikatów */
export function OwnedCardDialog({ pid, onClose }: { pid: string; onClose: () => void }) {
  useGame();
  const o = ownedMap()[pid];
  if (!o) return null;
  const p = person(pid), R = S.cfg.rarities[p.rarity], special = isSpecialCard(p);
  const favs = new Set(S.items.filter(i => i.fav).map(i => i.id));
  const dupes = dupesOf(o), dupesVar = dupesOf(o, true);
  const sell = async (ids: number[]) => {
    try { await sellIds(ids); } catch (e: any) { Sound.error(); toast(e.message, true); }
  };
  return (
    <Modal title={p.name} onClose={onClose} wide>
      <div className={styles.grid}>
        <Card person={pid} variant={o.best} className={styles.card} />
        <div className={styles.side}>
          <p className="muted">{S.cfg.types[p.type].name} · {crateOf(p.crate).name} · <b style={{ color: R.color }}>{R.name}</b></p>
          <p>Posiadasz: <b>{o.ids.length}</b></p>
          {special && <p className="muted">Karty specjalnej nie da się sprzedać grze, postawić w kasynie ani zużyć w kuźni. Możesz ją wymienić albo wystawić na rynku.</p>}
          {[...S.cfg.variantOrder].reverse().filter(v => o.byVar[v]).map(v => {
            const all = o.byVar[v], list = special ? [] : all.filter(id => !favs.has(id)), val = cardValue(pid, v), nFav = all.length - list.length;
            return (
              <div key={v} className={styles.row}>
                <span className={styles.lbl}>
                  <span className={`vdot ${vtClass(v)}`} />{variantName(v)} ×{all.length}
                  {nFav > 0 && !special && <span className={styles.fav}><Star size={13} aria-label="ulubione" />{nFav}</span>}
                  <small className="muted"> · {fmt(val)} za sztukę</small>
                </span>
                <span className={styles.btns}>
                  {list.length > 0 && <Button onClick={() => sell([list[0]])}>Sprzedaj 1</Button>}
                  {list.length > 1 && <Button onClick={() => sell(list)}>{nFav ? 'Pozostałe' : 'Wszystkie'} ({fmt(val * list.length)})</Button>}
                </span>
              </div>
            );
          })}
          <div className={styles.btns}>
            {dupes.length > 0 && <Button onClick={() => sell(dupes)}>Sprzedaj duplikaty, zostaw najlepszą</Button>}
            {dupesVar.length > 0 && dupesVar.length !== dupes.length && <Button onClick={() => sell(dupesVar)}>Zostaw po 1 z wariantu</Button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
