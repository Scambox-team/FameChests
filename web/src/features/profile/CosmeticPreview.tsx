import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useGame } from '../../game/store';
import { FramedAvatar } from '../../ui/FramedAvatar';
import { Modal } from '../../ui/Modal';
import { useCosmeticSrc, type CosmeticView } from './cosmetics';
import pk from './playerCard.module.css';
import s from './cosmeticPreview.module.css';

// Podgląd kosmetyku ze Sklepu „na sobie”: wybrana pozycja nałożona na to, co gracz ma teraz założone (reszta wyglądu bez zmian), w trzech miejscach:
// strona profilu (tło profilu), miniprofil (tło miniprofilu, obramówka, zdjęcie) i listy (ranking, znajomi - mała ikona). Nic nie jest zapisywane ani kupowane.

type Kind = 'mini' | 'frame' | 'bg' | 'avatar';
interface Owned extends CosmeticView { unlocked: boolean }
interface Data { items: Owned[]; equipped: Record<Kind, string> }
type Look = { mini: CosmeticView | null; frame: CosmeticView | null; bg: CosmeticView | null; avatar: CosmeticView | null };

function ProfileScene({ look, hot }: { look: Look; hot: boolean }) {
  const { me } = useGame();
  const bgSrc = useCosmeticSrc(look.bg);
  if (!me) return null;
  return (
    <figure className={`${s.cpScene}${hot ? ` ${s.cpHot}` : ''}`}>
      <figcaption>Strona profilu</figcaption>
      <div className={s.cpProfile}>
        {bgSrc && <div className={s.cpImg} style={{ backgroundImage: `url("${bgSrc}")` }} />}
        <div className={s.cpShade} />
        <div className={s.cpHead}>
          <FramedAvatar user={{ ...me, avatarImg: look.avatar?.url ?? null }} size={84} frame={look.frame} />
          <div className={s.cpPanel}>
            <b>{me.username}</b>
            <span className={s.cpBars}><i /><i /></span>
          </div>
        </div>
        <div className={s.cpTiles}><i /><i /><i /></div>
      </div>
    </figure>
  );
}

function MiniScene({ look, hot }: { look: Look; hot: boolean }) {
  const { me } = useGame();
  const src = useCosmeticSrc(look.mini);
  if (!me) return null;
  return (
    <figure className={`${s.cpScene}${hot ? ` ${s.cpHot}` : ''}`}>
      <figcaption>Miniprofil (po najechaniu na nazwę)</figcaption>
      <div className={`${pk.pkCard} ${pk.pkStatic} ${s.cpMini}`}>
        {src && <div className={pk.pkBg} style={{ backgroundImage: `url("${src}")` }} />}
        <div className={pk.pkTone} />
        <div className={pk.pkTop}>
          <FramedAvatar user={{ ...me, avatarImg: look.avatar?.url ?? null }} size={72} frame={look.frame} />
          <div className={pk.pkWho}>
            <b className={pk.pkNick}>{me.username}</b>
            <span className={pk.pkLine}><span className={pk.pkLv}>Twój miniprofil</span></span>
          </div>
        </div>
      </div>
    </figure>
  );
}

function ListScene({ look, hot }: { look: Look; hot: boolean }) {
  const { me } = useGame();
  if (!me) return null;
  const user = { ...me, avatarImg: look.avatar?.url ?? null };
  return (
    <figure className={`${s.cpScene}${hot ? ` ${s.cpHot}` : ''}`}>
      <figcaption>Ranking i listy</figcaption>
      <div className={s.cpList}>
        {[44, 32, 24].map((size, i) => (
          <div key={size} className={s.cpRow}><span className={s.cpPos}>{7 + i}</span><FramedAvatar user={user} size={size} frame={look.frame} /><b>{me.username}</b><i /></div>
        ))}
      </div>
    </figure>
  );
}

const INTRO: Record<Kind, string> = {
  mini: 'Tak wyglądałby twój miniprofil z tą pozycją. Reszta wyglądu to to, co masz teraz założone. Nic nie jest kupowane ani zapisywane.',
  frame: 'Tak wyglądałaby twoja ikona z tą pozycją. Reszta wyglądu to to, co masz teraz założone. Nic nie jest kupowane ani zapisywane.',
  bg: 'Tak wyglądałaby twoja strona profilu z tą pozycją. Reszta wyglądu to to, co masz teraz założone. Nic nie jest kupowane ani zapisywane.',
  avatar: 'Tak wyglądałaby twoja ikona z tą pozycją. Reszta wyglądu to to, co masz teraz założone. Nic nie jest kupowane ani zapisywane.'
};

export function CosmeticPreview({ item, onClose }: { item: CosmeticView; onClose: () => void }) {
  const { data } = useQuery<Data>({ queryKey: ['cosmetics'], queryFn: () => api('/api/cosmetics'), staleTime: 10_000 });
  const kind = item.kind as Kind;
  const worn = (k: Kind): CosmeticView | null => (kind === k ? item : data?.items.find(i => i.id === data.equipped[k]) ?? null);
  const look: Look = { mini: worn('mini'), frame: worn('frame'), bg: worn('bg'), avatar: worn('avatar') };
  const icon = kind === 'frame' || kind === 'avatar';
  return (
    <Modal title={`Podgląd: ${item.name}`} onClose={onClose} wide>
      <p className="muted small">{INTRO[kind]}</p>
      <div className={s.cpGrid}>
        {kind === 'bg' && <ProfileScene look={look} hot />}
        {kind !== 'bg' && <MiniScene look={look} hot={kind === 'mini'} />}
        {icon && <ListScene look={look} hot />}
        {kind !== 'bg' && <ProfileScene look={look} hot={false} />}
        {kind === 'bg' && <MiniScene look={look} hot={false} />}
      </div>
    </Modal>
  );
}
