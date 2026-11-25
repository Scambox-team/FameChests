import { Link } from 'react-router-dom';
import { useGame } from '../../game/store';
import { fmtNum } from '../../lib/format';
import s from './ExpBar.module.css';

/** Pasek EXP / level w górnym pasku (komputer) i w nagłówku telefonu (`compact` = sam level i cienki pasek). Prowadzi do strony „Poziom”. */
export function ExpBar({ compact }: { compact?: boolean }) {
  const g = useGame();
  const e = g.exp;
  if (!e) return null;
  const pct = e.max ? 100 : e.need ? Math.min(100, (e.into / e.need) * 100) : 0;
  const label = e.max ? `Level ${e.level} (maksymalny)` : `Level ${e.level}, ${fmtNum(e.into)} z ${fmtNum(e.need)} EXP do następnego`;
  return (
    <Link to="/level" className={`${s.xbar}${compact ? ` ${s.xcompact}` : ''}${e.max ? ` ${s.xmax}` : ''}`} aria-label={label} title={label}>
      <span className={s.xlv} aria-hidden="true">{e.level}</span>
      <span className={s.xtrack} aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      {!compact && <span className={s.xtxt} aria-hidden="true">{e.max ? 'MAX' : `${fmtNum(e.into)} / ${fmtNum(e.need)} EXP`}</span>}
      {g.expGain && <span key={g.expGain.id} className={s.xgain} role="status">+{fmtNum(g.expGain.n)} EXP</span>}
    </Link>
  );
}
