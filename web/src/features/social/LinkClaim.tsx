import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { epicReveal } from '../../fx/effects';
import { announceFirsts } from '../../game/actions';
import { person } from '../../game/rules';
import { applyState } from '../../game/session';
import { S, touch } from '../../game/store';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';

/** Link od admina do karty specjalnej: każdy gracz odbiera ją raz */
export function LinkClaim() {
  const { token } = useParams();
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    navigate('/inventory', { replace: true });
    (async () => {
      let res: any;
      try { res = await api(`/api/links/${encodeURIComponent(token!)}/claim`, {}); }
      catch (e: any) { Sound.error(); return toast(e.message, true); }
      S.items = [res.item, ...S.items];
      S.collected.add(`${res.item.person}|${res.item.variant}`);
      applyState(res.state);
      touch();
      await epicReveal(res.item, {});
      announceFirsts([res.item]);
      toast(`${person(res.item.person).name}: karta specjalna jest już w twoim ekwipunku`);
    })();
  }, [token, navigate]);
  return null;
}
