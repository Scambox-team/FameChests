import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { rarityIdx } from '../../game/rules';
import { applyState } from '../../game/session';
import { S } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { SK, SK_PIECES, skDef, skLoad, skPreview } from './skins';

/** Zakładka Figury w ekwipunku: skiny pogrupowane (duplikaty razem), załóż lub zdejmij, sprzedaj */
export function Figures() {
  const { data, refetch } = useQuery({ queryKey: ['skins'], queryFn: async () => { await skLoad(); return Date.now(); } });
  if (!data) return <p className="muted">Wczytuję figury</p>;

  const groups = new Map<string, any[]>();
  SK.owned.forEach((o: any) => { const k = `${o.skin}|${o.piece}`; (groups.get(k) || groups.set(k, []).get(k)!).push(o); });
  const order = (id: string) => rarityIdx(skDef(id)?.rarity || 'green');
  const rows = [...groups.values()].sort((a, b) => order(b[0].skin) - order(a[0].skin));

  const equip = async (piece: string, skin: string) => {
    try { await api('/api/games/chess/skins/equip', { piece, skin }); Sound.click(); }
    catch (e: any) { toast(e.message, true); }
    refetch();
  };
  const sell = async (ids: number[]) => {
    try {
      const r = await api('/api/games/chess/skins/sell', { ids });
      applyState(r.state);
      Sound.cash();
      toast(`Sprzedane za ${fmt(r.total)}`);
    } catch (e: any) { toast(e.message, true); }
    refetch();
  };

  return (
    <div className="panel">
      <h3>Moje figury</h3>
      <p className="muted small">Skiny wypadają ze skrzynek szachów, razem z kartą. Można je założyć w szachach albo sprzedać, nie trafiają na rynek, do wymian ani kasyna. Rywal też widzi twoje figury.</p>
      {rows.length ? <div className="sk-grid">{rows.map(g => {
        const o = g[0], s = skDef(o.skin), on = SK.equipped[o.piece] === o.skin, off = s?.enabled === false;
        const r = S.cfg.rarities[s?.rarity];
        return (
          <div key={`${o.skin}|${o.piece}`} className={`sk-tile${on ? ' on' : ''}${off ? ' off' : ''}`}>
            {g.length > 1 && <i className="sk-n">×{g.length}</i>}
            <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: skPreview(o.skin, o.piece) }} />
            <b>{s?.name || o.skin}</b>
            <small>{SK_PIECES[o.piece]}{r && <> · <span className="sk-rar" style={{ '--rc': r.color } as React.CSSProperties}>{r.name}</span></>}</small>
            <p className="muted small">{s?.desc || ''}</p>
            <div className="sk-btns">
              {off ? <span className="muted small">Wyłączony przez admina</span> : <Button kind={on ? 'plain' : 'hue'} onClick={() => equip(o.piece, on ? '' : o.skin)}>{on ? 'Zdejmij' : 'Załóż'}</Button>}
              <Button onClick={() => sell([o.id])}>Sprzedaj za {fmt(o.value)}</Button>
              {g.length > 1 && <Button onClick={() => sell(g.slice(1).map(x => x.id))}>Sprzedaj ×{g.length - 1}</Button>}
            </div>
          </div>
        );
      })}</div> : <p className="muted">Nie masz jeszcze żadnych figur. Wygraj partię szachów z graczem i otwórz skrzynkę.</p>}
    </div>
  );
}
