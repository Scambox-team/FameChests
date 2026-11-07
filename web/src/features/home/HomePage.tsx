import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChessKnight, Dices, Medal, Package, ScrollText, Swords, Trophy } from 'lucide-react';
import { api } from '../../api/client';
import { crateList, plural } from '../../game/rules';
import { S, useGame } from '../../game/store';
import { fmt, fmtNum } from '../../lib/format';
import { UserLink } from '../../ui/UserLink';
import { CrateArt } from '../crates/CrateArt';
import { PatchNotes } from '../notices/Notices';
import { QuestTile } from './QuestTile';
import s from './home.module.css';

const MEDALS = ['#e5b94a', '#c2c6cf', '#c98a55'];

// Strona startowa: kafelki do najważniejszych miejsc gry, po prawej ranking i ostatnia lista zmian
export function HomePage() {
  useEffect(() => { document.title = 'ScamBox'; }, []);
  return (
    <div className={s.home}>
      <div className={s.tiles}>
        <CratesTile />
        <ArenaTile />
        <QuestTile />
        <Link to="/games" className={`${s.tile} ${s.games}`}>
          <div className={s.board} aria-hidden="true"><ChessKnight className={s.knight} strokeWidth={1.3} /></div>
          <div className={s.copy}>
            <h2 className={s.name}>Gry</h2>
            <p className={s.lead}>Szachy z innymi graczami i neonowy pinball. Za każdą wygraną w szachy skrzynka w kolorze twoich figur.</p>
          </div>
          <ArrowRight className={s.go} size={20} aria-hidden="true" />
        </Link>
        <Link to="/casino" className={`${s.tile} ${s.casino}`}>
          <div className={s.wheel} aria-hidden="true"><i /><Dices className={s.dice} strokeWidth={1.4} /></div>
          <div className={s.copy}>
            <h2 className={s.name}>Kasyno</h2>
            <p className={s.lead}>Ruletka, blackjack, jednoręki bandyta, wyścigi konne i ulepszacz. Stawką są karty.</p>
          </div>
          <ArrowRight className={s.go} size={20} aria-hidden="true" />
        </Link>
      </div>
      <aside className={s.side}>
        <RankingBox />
        <PatchBox />
      </aside>
    </div>
  );
}

function CratesTile() {
  const game = useGame();
  // skrzynki ze sklepu, najpierw te, które gracz ma; największa na środku
  const crates = useMemo(() => crateList().filter(c => c.shop && !c.special && (!c.restricted || c.canBuy))
    .sort((a, b) => (S.chests[b.id] || 0) - (S.chests[a.id] || 0)).slice(0, 5), [game.cfg, game.state]);
  const owned = Object.values(S.chests ?? {}).reduce((a: number, n: any) => a + (n || 0), 0);
  const fan = [crates[3], crates[1], crates[0], crates[2], crates[4]].filter(Boolean);
  return (
    <Link to="/crates" className={`${s.tile} ${s.crates}`}>
      <div className={s.shelf} aria-hidden="true">
        {fan.map(c => <CrateArt key={c.id} crate={c} className={`${s.crate}${c === crates[0] ? ` ${s.main}` : ''}`} />)}
      </div>
      <div className={s.copy}>
        <span className={s.kicker}><Package size={15} aria-hidden="true" />{crates.length} {plural(crates.length, 'skrzynka', 'skrzynki', 'skrzynek')} w sklepie</span>
        <h2 className={`${s.name} ${s.big}`}>Skrzynki</h2>
        <p className={s.lead}>{owned ? `Masz ${fmtNum(owned)} ${plural(owned, 'skrzynkę', 'skrzynki', 'skrzynek')} do otwarcia.` : 'Kup skrzynkę i sprawdź, kto z niej wypadnie.'}</p>
      </div>
      <span className={s.cta}>{owned ? 'Otwórz skrzynkę' : 'Do sklepu'}<ArrowRight size={18} aria-hidden="true" /></span>
    </Link>
  );
}

function ArenaTile() {
  const { cfg } = useGame();
  const body = (
    <>
      <div className={s.arenaArt} aria-hidden="true"><Swords className={s.swords} strokeWidth={1.1} /></div>
      <div className={s.copy}>
        <span className={s.soon}>Już wkrótce</span>
        <h2 className={`${s.name} ${s.big}`}>Arena</h2>
        <p className={s.lead}>Walki twoimi kartami jeden na jednego: zdolności, punkty życia i monety.</p>
      </div>
    </>
  );
  // admini mają wersję testową
  if (cfg.arena) return <Link to="/arena" className={`${s.tile} ${s.arena}`}>{body}<ArrowRight className={s.go} size={20} aria-hidden="true" /></Link>;
  return <div className={`${s.tile} ${s.arena}`} aria-disabled="true">{body}</div>;
}

function RankingBox() {
  const { data: r } = useQuery({ queryKey: ['ranking'], queryFn: () => api('/api/ranking') });
  const list = useMemo(() => [...(r?.players ?? [])].sort((a: any, b: any) => b.value - a.value || a.username.localeCompare(b.username, 'pl')), [r]);
  const top = list.slice(0, 8), mine = list.findIndex((p: any) => p.me);
  return (
    <section className={s.box} aria-labelledby="homeRanking">
      <header className={s.boxHead}>
        <h2 id="homeRanking"><Trophy size={17} aria-hidden="true" />Ranking</h2>
        <Link to="/ranking" className={s.more}>Cały ranking</Link>
      </header>
      {!r ? <p className="muted small">Ładowanie</p> : (
        <ol className={s.rank}>
          {top.map((p: any, i: number) => <RankRow key={p.username} p={p} i={i} />)}
          {mine >= top.length && <><li className={s.gap} aria-hidden="true" /><RankRow p={list[mine]} i={mine} /></>}
        </ol>
      )}
    </section>
  );
}

function RankRow({ p, i }: { p: any; i: number }) {
  return (
    <li className={`${s.rankRow}${p.me ? ` ${s.me}` : ''}`}>
      <span className={s.pos}>{i < 3 ? <Medal size={18} color={MEDALS[i]} aria-label={`${i + 1}. miejsce`} /> : i + 1}</span>
      <UserLink user={p} />
      <span className={s.val}>{fmt(p.value)}</span>
    </li>
  );
}

// wpisy listy zmian mają HTML z emotkami: tu sam tekst
const plain = (html: string) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
};

function PatchBox() {
  const { data } = useQuery({ queryKey: ['patchnotes'], queryFn: () => api('/api/patchnotes') });
  const [open, setOpen] = useState(false);
  const note = data?.notes?.[0];
  if (!note) return null;
  return (
    <section className={s.box} aria-labelledby="homePatch">
      <header className={s.boxHead}>
        <h2 id="homePatch"><ScrollText size={17} aria-hidden="true" />Co nowego</h2>
        <span className="muted small">{new Date(note.date).toLocaleDateString('pl-PL')}</span>
      </header>
      <b className={s.patchTitle}>{plain(note.title)}</b>
      <ul className={s.patch}>{note.items.slice(0, 4).map((t: string, i: number) => <li key={i}>{plain(t)}</li>)}</ul>
      <button type="button" className={s.more} onClick={() => setOpen(true)}>Cała lista zmian{note.items.length > 4 ? ` (${note.items.length})` : ''}</button>
      {open && <PatchNotes notes={data.notes} onClose={() => setOpen(false)} />}
    </section>
  );
}
