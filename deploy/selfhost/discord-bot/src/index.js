// Bot Discorda społeczności scambox.pl.
// Co minutę pyta grę o stan (jedno zapytanie /api/bot/snapshot) i wypełnia kanały, których id podasz w .env (sam nic nie zakłada):
//   statystyki  - nazwy kanałów głosowych z liczbą kont i graczy online (Discord: zmiana nazwy najwyżej 2 razy / 10 min)
//   ranking     - jedna wiadomość, którą bot edytuje
//   questy      - nowy quest = nowa wiadomość, wykonany / skończony = edycja
//   eventy      - wiadomość na event, edytowana aż do końca
//   skrzynki    - nowa wiadomość po każdej rotacji sklepu (o północy)
//   komendy     - /profil gracz, /ranking, /quest, /skrzynki (wymagają zakresu applications.commands przy zaproszeniu)
// Konfiguracja: zmienne środowiskowe (patrz README.md w tym katalogu).

import fs from 'node:fs';
import path from 'node:path';
import {
  ApplicationCommandOptionType, Client, EmbedBuilder, GatewayIntentBits,
} from 'discord.js';
import { card, cardSearch, player, playerNames, snapshot } from './game.js';
import { closeRenderer, renderCard } from './render.js';
import { createFeatures } from './features.js';
import { clip, day, full, gr, num, pct, rel, stamp } from './format.js';

const env = (k, d = '') => (process.env[k] ?? d).trim();
const TOKEN = env('DISCORD_TOKEN');
const GUILD_ID = env('DISCORD_GUILD_ID');
const PING_ROLE = env('DISCORD_PING_ROLE_ID');
const COMMANDS_ONLY = env('COMMANDS_ONLY', '1') !== '0';
const STATE_FILE = path.join(env('DATA_DIR', '/data'), 'state.json');
const TICK_MS = 60_000;
// Discord pozwala na 2 zmiany nazwy kanału na 10 minut - 10 minut to bezpieczny odstęp
const STATS_EVERY_MS = Math.max(10, Number(env('STATS_EVERY_MIN', '10')) || 10) * 60_000;
const GOLD = 0xe5b94a;

if (!TOKEN || !GUILD_ID) {
  console.error('Ustaw DISCORD_TOKEN i DISCORD_GUILD_ID (deploy/selfhost/.env).');
  process.exit(1);
}
if (env('BOT_TOKEN').length < 16) {
  console.error('Ustaw BOT_TOKEN (min. 16 znaków, taki sam w grze i w bocie).');
  process.exit(1);
}

// ---------------------------------------------------------------- stan (przeżywa restart)

let state = { ranking: null, quest: null, events: {}, crates: null, statsAt: 0 };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
} catch { /* pierwszy start */ }

// zmiana wyglądu wiadomości i nazw (UI_VERSION): po aktualizacji bota odświeżamy wszystko od razu, nie czekając na zmianę danych
const UI_VERSION = 3;
if (state.ui !== UI_VERSION) {
  state.ui = UI_VERSION;
  state.statsAt = 0;
  if (state.ranking) state.ranking.hash = '';
  if (state.quest) state.quest.hash = '';
  for (const e of Object.values(state.events ?? {})) e.hash = '';
}

function save() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state));
    fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
  } catch (e) {
    console.error('Nie zapisano stanu:', e.message);
  }
}

// ---------------------------------------------------------------- kanały

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let guild;

// Bot niczego sam nie zakłada: kanały tworzysz na serwerze ręcznie i wpisujesz ich id w .env (DISCORD_CH_*).
// Kanał bez id = ta funkcja jest po prostu pominięta.
const CHANNELS = {
  accounts: { env: 'CH_ACCOUNTS', what: 'licznik kont (kanał GŁOSOWY, bot zmienia jego nazwę)', label: 'Konta', emoji: '👥' },
  online: { env: 'CH_ONLINE', what: 'licznik graczy online (kanał GŁOSOWY, bot zmienia jego nazwę)', label: 'Online', emoji: '🟢' },
  ranking: { env: 'CH_RANKING', what: 'ranking graczy' },
  quests: { env: 'CH_QUESTS', what: 'questy' },
  events: { env: 'CH_EVENTS', what: 'eventy' },
  crates: { env: 'CH_CRATES', what: 'skrzynki i rotacja' },
  patch: { env: 'CH_PATCH', what: 'ogłoszenia o aktualizacjach' },
  drops: { env: 'CH_DROPS', what: 'rzadkie dropy' },
  alerts: { env: 'CH_ALERTS', what: 'alerty o awarii gry (bez kanału: wiadomość prywatna do właściciela serwera)' },
  commands: { env: 'CH_COMMANDS', what: 'kanał komend (poza nim komendy są odrzucane, o ile COMMANDS_ONLY=1)' },
};

const counterName = (key, value) => `${CHANNELS[key].emoji} | ${CHANNELS[key].label}: ${value}`;
const warned = new Set();

/** Kanał z DISCORD_CH_<KLUCZ> albo null (wtedy funkcja jest pomijana; ostrzeżenie raz w logu) */
async function channel(key) {
  const cfg = CHANNELS[key];
  const id = env(cfg.env);
  if (!id) {
    if (!warned.has(key)) {
      warned.add(key);
      console.log(`[kanały] brak ${cfg.env} w .env - pomijam: ${cfg.what}`);
    }
    return null;
  }
  try {
    return await guild.channels.fetch(id);
  } catch (e) {
    if (!warned.has(`${key}:err`)) {
      warned.add(`${key}:err`);
      console.error(`[kanały] ${cfg.env}=${id}: nie ma takiego kanału albo bot go nie widzi (${e.message})`);
    }
    return null;
  }
}

// ---------------------------------------------------------------- wiadomości

/** Edytuje wiadomość o danym id; gdy jej nie ma (skasowana) - wysyła nową. Zwraca id. */
async function upsert(ch, id, payload) {
  if (id) {
    try {
      const m = await ch.messages.fetch(id);
      await m.edit(payload);
      return m.id;
    } catch (e) {
      if (e.code !== 10008 && e.status !== 404) throw e; // 10008 = Unknown Message
    }
  }
  return (await ch.send(payload)).id;
}

const mention = () => (PING_ROLE ? { content: `<@&${PING_ROLE}>`, allowedMentions: { roles: [PING_ROLE] } } : { allowedMentions: { parse: [] } });

// ogłoszenia o aktualizacjach i dropach, alert o awarii, /polacz i role za ranking (features.js)
const features = createFeatures({ client, state, save, getGuild: () => guild, channel, mention });

// ---------------------------------------------------------------- statystyki

async function stats(snap) {
  if (Date.now() - state.statsAt < STATS_EVERY_MS) return;
  const rename = async (key, name) => {
    const ch = await channel(key);
    if (ch && ch.name !== name) await ch.setName(name);
  };
  await rename('accounts', counterName('accounts', num(snap.accounts)));
  await rename('online', counterName('online', num(snap.online)));
  state.statsAt = Date.now();
  save();
}

// ---------------------------------------------------------------- ranking

const MEDAL = ['🥇', '🥈', '🥉'];

function rankingEmbed(snap) {
  const lines = (list, fmt) => (list.length ? list.map((p, i) => `${MEDAL[i] ?? `**${i + 1}.**`} ${clip(p.username, 24)} — ${fmt(p)}`).join('\n') : 'Brak graczy');
  return new EmbedBuilder()
    .setColor(GOLD)
    .setTitle('🏆 Ranking ScamBox')
    .addFields(
      { name: '💰 Wartość kolekcji', value: lines(snap.ranking.value, (p) => gr(p.value)) },
      { name: '🃏 Zebrane karty', value: lines(snap.ranking.cards, (p) => `${num(p.unique)} / ${num(snap.totalCards)}`) },
      { name: '📦 Otwarte skrzynki', value: lines(snap.ranking.opened, (p) => num(p.opened)) },
    )
    .setFooter({ text: `${num(snap.accounts)} kont · ${num(snap.online)} online · odświeżono` })
    .setTimestamp();
}

async function ranking(snap) {
  const ch = await channel('ranking');
  if (!ch) return;
  const payload = { embeds: [rankingEmbed(snap)] };
  // wiadomość zmienia się tylko, gdy zmienił się ranking (znacznik czasu w stopce nie liczy się)
  const h = stamp([snap.ranking, snap.accounts, snap.online]);
  if (state.ranking?.hash === h && state.ranking?.id) return;
  state.ranking = { id: await upsert(ch, state.ranking?.id, payload), hash: h };
  save();
}

// ---------------------------------------------------------------- questy

function questEmbed(q) {
  const e = new EmbedBuilder().setColor(q.done ? 0x59c27a : GOLD).setTitle(q.done ? '✅ Quest wykonany' : '🎯 Aktualny quest');
  const target = q.personName ?? 'karta';
  const how = q.variant ? `w wariancie ${q.variant}` : q.minMult > 1 ? `w wariancie o mnożniku wartości min. ×${q.minMult}` : 'w dowolnym wariancie';
  e.setDescription(`Zdobądź kartę **${target}**${q.rarity ? ` (${q.rarity})` : ''} ${how}. Liczą się karty ze skrzynek, kuźni, ulepszacza i kasyna - nie z rynku ani wymiany.`);
  if (q.reward) e.addFields({ name: '🎁 Nagroda', value: gr(q.reward), inline: true });
  if (q.done) {
    e.addFields(
      { name: '🏅 Wykonał(a)', value: q.winner ?? '—', inline: true },
      { name: '🃏 Zdobyta karta', value: q.wonPerson ?? '—', inline: true },
      { name: '⏭️ Następny quest', value: rel(q.nextAt), inline: true },
    );
  } else {
    e.addFields({ name: '⏰ Koniec', value: `${rel(q.endsAt)} (${full(q.endsAt)})`, inline: true });
    if (q.crateNames?.length) e.addFields({ name: '📦 Wypada ze skrzynek', value: clip(q.crateNames.join(', '), 1000), inline: true });
  }
  return e;
}

async function quests(snap) {
  const q = snap.quest;
  if (!q) return;
  const ch = await channel('quests');
  if (!ch) return;
  const st = state.quest;

  if (!st || st.day !== q.day) {
    const msg = await ch.send({ ...mention(), embeds: [questEmbed(q)] });
    state.quest = { day: q.day, id: msg.id, hash: stamp(q), done: !!q.done };
    save();
    return;
  }
  const h = stamp([q.done, q.winner, q.wonPerson, q.crateNames, q.endsAt, q.nextAt]);
  if (st.hash === h) return;
  st.id = await upsert(ch, st.id, { embeds: [questEmbed(q)] });
  st.hash = h;
  if (q.done && !st.done) {
    st.done = true;
    await ch.send({ content: `🎉 Quest wykonany przez **${q.winner ?? 'gracza'}**. Następny ${rel(q.nextAt)}.`, allowedMentions: { parse: [] } });
  }
  save();
}

// ---------------------------------------------------------------- eventy

function eventEmbed(e, ended = false) {
  const t = Math.floor(Date.now() / 1000);
  const status = ended ? 'zakończony' : t < e.startsAt ? `startuje ${rel(e.startsAt)}` : `trwa, koniec ${rel(e.endsAt)}`;
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x6b7280 : GOLD)
    .setTitle(clip(`🎉 ${e.name}`, 250))
    .setDescription(clip(`${e.desc || 'Event w grze.'}\n\n📅 **Termin:** ${day(e.start)} – ${day(e.end)} (${status})`, 4000));
  if (e.drops?.length) embed.addFields({ name: '🎲 Wypadają ze skrzynek', value: clip(e.drops.map((d) => `${d.name} — szansa ${pct(d.chance)}`).join('\n'), 1000) });
  return embed;
}

async function events(snap) {
  const ch = await channel('events');
  if (!ch) return;
  const live = new Set(snap.events.map((e) => e.id));

  for (const e of snap.events) {
    const st = state.events[e.id];
    const h = stamp([e.name, e.desc, e.start, e.end, e.drops, e.active]);
    if (!st) {
      const msg = await ch.send({ ...mention(), embeds: [eventEmbed(e)] });
      state.events[e.id] = { id: msg.id, hash: h, active: !!e.active };
      save();
    } else if (st.hash !== h) {
      st.id = await upsert(ch, st.id, { embeds: [eventEmbed(e)] });
      if (e.active && !st.active) await ch.send({ content: `🚀 Event **${clip(e.name, 100)}** wystartował!`, allowedMentions: { parse: [] } });
      st.hash = h;
      st.active = !!e.active;
      save();
    }
  }
  // event zniknął z listy gry = skończony albo wyłączony
  for (const [id, st] of Object.entries(state.events)) {
    if (live.has(id) || st.ended) continue;
    try {
      const m = await ch.messages.fetch(st.id);
      const old = m.embeds[0];
      if (old) await m.edit({ embeds: [EmbedBuilder.from(old).setColor(0x6b7280).setFooter({ text: '🏁 Event zakończony' })] });
    } catch { /* wiadomość skasowana */ }
    st.ended = true;
    save();
  }
}

// ---------------------------------------------------------------- skrzynki

function cratesEmbed(snap) {
  return new EmbedBuilder()
    .setColor(GOLD)
    .setTitle('📦 Skrzynki w sklepie')
    .setDescription(snap.crates.map((c) => `${c.emoji ? `${c.emoji} ` : ''}**${c.name}** — ${gr(c.price)}${c.mode === 'rotation' ? '' : ` (${c.mode === 'seasonal' ? 'sezonowa' : 'stała'})`}`).join('\n') || 'Sklep jest pusty')
    .addFields({ name: '🔄 Następna rotacja', value: `${rel(snap.nextRotation)} (${full(snap.nextRotation)})` });
}

async function crates(snap) {
  const ch = await channel('crates');
  if (!ch) return;
  // jedna rotacja = jedna wiadomość; po północy (zmiana nextRotation albo składu) pojawia się nowa
  const key = stamp(snap.crates.map((c) => c.id));
  const st = state.crates;
  if (!st || st.key !== key || st.next !== snap.nextRotation) {
    const msg = await ch.send({ ...(st ? mention() : {}), embeds: [cratesEmbed(snap)], allowedMentions: PING_ROLE && st ? { roles: [PING_ROLE] } : { parse: [] } });
    state.crates = { key, next: snap.nextRotation, id: msg.id };
    save();
  }
}

// ---------------------------------------------------------------- komendy

const COMMANDS = [
  {
    name: 'profil',
    description: 'Dane gracza ScamBox: kolekcja, miejsca w rankingu, najcenniejsze karty',
    options: [{ name: 'gracz', description: 'Nazwa gracza w grze', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }],
  },
  {
    name: 'ranking',
    description: 'Top 10 graczy',
    options: [{
      name: 'wedlug', description: 'Według czego (domyślnie wartość kolekcji)', type: ApplicationCommandOptionType.String,
      choices: [{ name: 'Wartość kolekcji', value: 'value' }, { name: 'Zebrane karty', value: 'cards' }, { name: 'Otwarte skrzynki', value: 'opened' }],
    }],
  },
  {
    name: 'karta',
    description: 'Pokaż kartę z gry, tak jak wygląda w grze (opcjonalnie w wybranym wariancie)',
    options: [
      { name: 'nazwa', description: 'Nazwa karty', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
      { name: 'wariant', description: 'Wariant karty (domyślnie zwykły)', type: ApplicationCommandOptionType.String, autocomplete: true },
    ],
  },
  { name: 'quest', description: 'Aktualny quest' },
  { name: 'skrzynki', description: 'Skrzynki w sklepie i następna rotacja' },
  { name: 'polacz', description: 'Połącz konto Discord z kontem w grze (nagroda + role za miejsce w rankingu)' },
];

async function registerCommands() {
  try {
    await guild.commands.set(COMMANDS);
  } catch (e) {
    console.error('Nie zarejestrowano komend (/profil, /ranking...). Zaproś bota ponownie z zakresem "applications.commands" (README.md):', e.message);
  }
}

/** Odpowiedź na /karta: obrazek karty z gry + podstawowe dane. `nazwa` to id z podpowiedzi albo wpisany tekst. */
async function cardReply(nazwa, wariant) {
  let c = await card(nazwa);
  if (!c.found) {
    // wpisano nazwę ręcznie, bez wyboru z podpowiedzi: bierzemy pierwszą pasującą kartę
    const [first] = await cardSearch(nazwa);
    if (first) c = await card(first.id);
  }
  if (!c.found) return 'Nie znalazłem takiej karty. Zacznij pisać nazwę i wybierz kartę z podpowiedzi.';
  const v = c.variants.find((x) => x.key === wariant) ?? c.variants.find((x) => x.key === 'normal') ?? c.variants[0];
  const png = await renderCard(c.id, v?.key ?? 'normal');
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(`🃏 ${clip(c.name, 100)}`)
    .setDescription(`**${c.rarity}**${v && v.key !== 'normal' ? ` · wariant **${v.name}**` : ''}${v ? ` · wartość **${gr(v.value)}**` : ''}`)
    .setImage('attachment://karta.png');
  return { embeds: [embed], files: [{ attachment: png, name: 'karta.png' }] };
}

function profileEmbed(p) {
  const n = p.totalCards || 1;
  const top = p.topCards.length
    ? p.topCards.map((c, i) => `${i + 1}. **${c.name}**${c.variant ? ` (${c.variant})` : ''} — ${gr(c.value)}`).join('\n')
    : 'Brak kart';
  return new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(`🃏 Profil: ${clip(p.username, 60)}`)
    .addFields(
      { name: '💰 Wartość kolekcji', value: `${gr(p.value)}\nmiejsce **#${p.places.value}** z ${num(p.players)}`, inline: true },
      { name: '🃏 Zebrane karty', value: `${num(p.unique)} / ${num(p.totalCards)} (${Math.round((p.unique / n) * 100)}%)\nmiejsce **#${p.places.cards}**`, inline: true },
      { name: '📦 Otwarte skrzynki', value: `${num(p.opened)}\nmiejsce **#${p.places.opened}**`, inline: true },
      { name: '📜 Kontrakty', value: num(p.contracts), inline: true },
      { name: '⚗️ Ulepszacz', value: `${num(p.upgradesWon)} udanych / ${num(p.upgradesLost)} nieudanych`, inline: true },
      { name: '📅 W grze od', value: full(p.created), inline: true },
      { name: '💎 Najcenniejsze karty', value: clip(top, 1000) },
    );
}

client.on('interactionCreate', async (i) => {
  try {
    if (i.isAutocomplete()) {
      if (i.commandName === 'karta') {
        const f = i.options.getFocused(true);
        if (f.name === 'nazwa') {
          const found = await cardSearch(f.value);
          await i.respond(found.map((c) => ({ name: clip(`${c.name} (${c.rarity})`, 100), value: c.id })));
        } else {
          // warianty tej karty (wybrana z podpowiedzi nazwa to jej id), z wartością w groszach
          const c = await card(i.options.getString('nazwa') ?? '');
          const typed = f.value.toLowerCase();
          const list = (c.variants ?? []).filter((v) => v.name.toLowerCase().includes(typed) || v.key.includes(typed)).slice(0, 25);
          await i.respond(list.map((v) => ({ name: clip(`${v.name} — ${gr(v.value)}`, 100), value: v.key })));
        }
        return;
      }
      const names = await playerNames(i.options.getFocused());
      await i.respond(names.map((name) => ({ name: clip(name, 100), value: clip(name, 100) })));
      return;
    }
    if (!i.isChatInputCommand()) return;
    // komendy publiczne działają tylko na kanale #komendy (DISCORD_COMMANDS_ONLY=0 wyłącza ten wymóg); /polacz jest prywatne, więc wszędzie
    if (COMMANDS_ONLY && i.commandName !== 'polacz') {
      const cmdCh = await channel('commands');
      if (cmdCh && i.channelId !== cmdCh.id) {
        await i.reply({ content: `Komend używaj na kanale <#${cmdCh.id}>.`, ephemeral: true });
        return;
      }
    }
    // kod do połączenia konta widzi tylko ten, kto go zażądał
    await i.deferReply(i.commandName === 'polacz' ? { ephemeral: true } : {});
    if (i.commandName === 'polacz') {
      await i.editReply(await features.linkReply(i.user.id));
      return;
    }
    if (i.commandName === 'karta') {
      await i.editReply(await cardReply(i.options.getString('nazwa', true), i.options.getString('wariant')));
      return;
    }
    if (i.commandName === 'profil') {
      const p = await player(i.options.getString('gracz', true));
      await i.editReply(p.found ? { embeds: [profileEmbed(p)] } : 'Nie ma takiego gracza w rankingu. Wpisz nazwę dokładnie albo wybierz z podpowiedzi.');
      return;
    }
    const snap = await snapshot();
    if (i.commandName === 'ranking') {
      const by = i.options.getString('wedlug') ?? 'value';
      const list = snap.ranking[by];
      const fmt = { value: (p) => gr(p.value), cards: (p) => `${num(p.unique)} / ${num(snap.totalCards)}`, opened: (p) => num(p.opened) }[by];
      const title = { value: '💰 Wartość kolekcji', cards: '🃏 Zebrane karty', opened: '📦 Otwarte skrzynki' }[by];
      const lines = list.map((p, k) => `${MEDAL[k] ?? `**${k + 1}.**`} ${clip(p.username, 24)} — ${fmt(p)}`).join('\n') || 'Brak graczy';
      await i.editReply({ embeds: [new EmbedBuilder().setColor(GOLD).setTitle(`🏆 Ranking: ${title}`).setDescription(lines)] });
    } else if (i.commandName === 'quest') {
      await i.editReply(snap.quest ? { embeds: [questEmbed(snap.quest)] } : 'Questy są teraz wyłączone.');
    } else if (i.commandName === 'skrzynki') {
      await i.editReply({ embeds: [cratesEmbed(snap)] });
    }
  } catch (e) {
    console.error(`[komenda ${i.commandName ?? 'autouzupełnianie'}]`, e.message);
    if (i.isAutocomplete()) return;
    const msg = 'Nie udało się pobrać danych z gry, spróbuj za chwilę.';
    await (i.deferred || i.replied ? i.editReply(msg) : i.reply({ content: msg, ephemeral: true })).catch(() => {});
  }
});

// ---------------------------------------------------------------- pętla

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const snap = await snapshot();
    await features.health(true).catch((e) => console.error('[alert]', e.message));
    // każda część osobno: błąd w jednym kanale (np. brak uprawnień) nie zatrzymuje reszty
    const parts = [
      ['statystyki', stats], ['ranking', ranking], ['questy', quests], ['eventy', events], ['skrzynki', crates],
      ['zmiany', features.patch], ['dropy', features.drops], ['role', features.syncRoles],
    ];
    for (const [name, fn] of parts) {
      try {
        await fn(snap);
      } catch (e) {
        console.error(`[${name}]`, e.message);
      }
    }
  } catch (e) {
    console.error('Nie pobrano danych z gry:', e.message);
    await features.health(false, e.message).catch((err) => console.error('[alert]', err.message));
  } finally {
    busy = false;
  }
}

client.once('ready', async () => {
  try {
    guild = await client.guilds.fetch(GUILD_ID);
  } catch {
    console.error(`Bot nie jest na serwerze ${GUILD_ID} (zaproś go linkiem z README.md).`);
    process.exit(1);
  }
  console.log(`Bot ${client.user.tag} działa na serwerze ${guild.name}`);
  await registerCommands();
  await features.ensureRoles();
  await tick();
  setInterval(tick, TICK_MS);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    save();
    closeRenderer();
    client.destroy();
    process.exit(0);
  });
}

client.login(TOKEN);
