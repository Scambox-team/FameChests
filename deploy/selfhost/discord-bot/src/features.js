// Dodatkowe funkcje bota: ogłoszenia o aktualizacjach i rzadkich dropach, alert o awarii gry,
// powiązanie kont Discord z kontami w grze (kod z /polacz) i role za miejsce w rankingu.
// Dostaje wspólny kontekst z index.js (klient, stan, kanały), żeby nie importować się nawzajem.

import { EmbedBuilder } from 'discord.js';
import * as game from './game.js';
import { clip } from './format.js';
import { renderCard } from './render.js';
import { ROLE_DEFS, ROLE_ORDER, rolesFor } from './roles.js';

const GOLD = 0xe5b94a;
const GAME_PUBLIC_URL = (process.env.GAME_PUBLIC_URL || '').replace(/\/$/, '');
const ALERT_AFTER = Math.max(1, Number(process.env.ALERT_AFTER_MIN) || 3); // tyle nieudanych sprawdzeń z rzędu (co minutę)
const ROLES_EVERY_MS = 5 * 60_000;

const RARITY_COLOR = { gold: 0xf5c542, ultra: 0xff4fd8, secret: 0x9b59ff };

/** HTML z listy zmian gry (<b>, emotki) -> tekst Discorda */
const plain = (s) =>
  String(s)
    .replace(/<b>(.*?)<\/b>/g, '**$1**')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');

export function createFeatures({ client, state, save, getGuild, channel, mention }) {
  // ------------------------------------------------------------ ogłoszenia o aktualizacjach

  async function patch(snap) {
    const n = snap.patch;
    if (!n?.v) return;
    // pierwszy start: zapamiętujemy aktualną wersję bez ogłaszania (nie zalewamy kanału starą listą zmian)
    if (state.patch == null) {
      state.patch = n.v;
      save();
      return;
    }
    if (n.v <= state.patch) return;
    const ch = await channel('patch');
    if (!ch) return;
    const items = (n.items ?? []).map((x) => `• ${plain(x)}`).join('\n');
    await ch.send({
      ...mention(),
      embeds: [
        new EmbedBuilder()
          .setColor(GOLD)
          .setTitle(clip(`📰 Aktualizacja: ${plain(n.title ?? `#${n.v}`)}`, 250))
          .setDescription(clip(items || 'Szczegóły w grze.', 4000))
          .setFooter({ text: `Wersja ${n.v}${n.date ? ` · ${n.date}` : ''}` }),
      ],
    });
    state.patch = n.v;
    save();
  }

  // ------------------------------------------------------------ rzadkie dropy

  async function drops() {
    // bez znanego miejsca startu pytamy bez "after": gra zwraca max i pustą listę - zaczynamy od teraz
    const r = await game.drops(state.dropAfter);
    if (state.dropAfter == null) {
      state.dropAfter = r.max;
      save();
      return;
    }
    if (!r.drops.length) return;
    const ch = await channel('drops');
    if (!ch) return;
    for (const d of r.drops) {
      const what = d.secret ? '**Tajna karta**' : `**${d.person}**${d.variant ? ` (${d.variant})` : ''}`;
      const embed = new EmbedBuilder()
        .setColor(RARITY_COLOR[d.rarityKey] ?? GOLD)
        .setTitle(`💎 ${d.rarity}!`)
        .setDescription(`Ze skrzynki gracza **${clip(d.username, 40)}** wypadła karta ${what}.`)
        .setTimestamp(d.at * 1000);
      // obrazek karty z gry (tylko jawne karty; Tajna zostaje tajemnicą). Gdy render zawiedzie, ogłoszenie idzie bez obrazka.
      let files;
      if (!d.secret && d.personId) {
        try {
          files = [{ attachment: await renderCard(d.personId, d.variantKey || 'normal'), name: 'karta.png' }];
          embed.setImage('attachment://karta.png');
        } catch (e) {
          console.error('[dropy] nie narysowano karty:', e.message);
        }
      }
      await ch.send({ allowedMentions: { parse: [] }, embeds: [embed], files });
      state.dropAfter = d.id;
      save();
    }
  }

  // ------------------------------------------------------------ alert o awarii gry

  /** Alert na kanał DISCORD_CH_ALERTS (z pingiem właściciela serwera); bez kanału: wiadomość prywatna do właściciela */
  async function notifyAdmin(text, ping = false) {
    const guild = getGuild();
    const ch = await channel('alerts');
    try {
      if (ch) {
        await ch.send({ content: ping ? `<@${guild.ownerId}> ${text}` : text, allowedMentions: ping ? { users: [guild.ownerId] } : { parse: [] } });
      } else {
        await (await guild.fetchOwner()).send(text);
      }
    } catch (e) {
      console.error('[alert] nie wysłano:', e.message);
    }
  }

  /** Wywoływane po każdej próbie pobrania danych z gry (ok = udało się) */
  async function health(ok, error) {
    const a = (state.alert ??= { fails: 0, since: null });
    if (ok) {
      const wasDown = a.since;
      a.fails = 0;
      a.since = null;
      if (wasDown) {
        const min = Math.max(1, Math.round((Date.now() - wasDown) / 60_000));
        await notifyAdmin(`✅ Gra znów odpowiada (przerwa ok. ${min} min).`);
      }
      save();
      return;
    }
    a.fails += 1;
    if (a.fails === ALERT_AFTER && !a.since) {
      a.since = Date.now() - (ALERT_AFTER - 1) * 60_000;
      await notifyAdmin(`🚨 Gra nie odpowiada od ok. ${ALERT_AFTER} min: ${clip(String(error), 300)}`, true);
    }
    save();
  }

  // ------------------------------------------------------------ powiązanie kont i role

  /** /polacz: kod do wpisania w grze albo informacja, że konto już jest połączone */
  async function linkReply(discordId) {
    const r = await game.linkCode(discordId);
    if (r.linked) return `Twoje konto Discord jest połączone z graczem **${r.username}**. Odłączysz je w grze: Ustawienia → Discord.`;
    const where = GAME_PUBLIC_URL ? `${GAME_PUBLIC_URL}/ustawienia` : 'w grze: Ustawienia → Discord';
    return `Twój kod: **\`${r.code}\`** (ważny ${Math.round(r.ttl / 60)} min).\nWpisz go ${where} w sekcji **Discord**. Za pierwsze połączenie dostaniesz nagrodę, a bot nada Ci rolę za miejsce w rankingu.`;
  }

  /** Role z bota (tworzone, jeśli ich nie ma; id w stanie). Zwraca { klucz: Role } */
  async function roles() {
    const guild = getGuild();
    state.roles ??= {};
    const out = {};
    for (const key of ROLE_ORDER) {
      const def = ROLE_DEFS[key];
      let role = state.roles[key] ? await guild.roles.fetch(state.roles[key]).catch(() => null) : null;
      // rola o tej nazwie mogła powstać wcześniej (ręcznie albo przy poprzednim wdrożeniu): używamy jej zamiast dubla
      role ??= (await guild.roles.fetch()).find((r) => r.name === def.name) ?? null;
      if (role) {
        state.roles[key] = role.id;
      } else {
        role = await guild.roles.create({
          name: def.name,
          color: def.color,
          hoist: def.hoist ?? false,
          mentionable: def.mentionable ?? false,
          reason: 'Role ScamBox za statystyki połączonego konta',
        });
        state.roles[key] = role.id;
      }
      out[key] = role;
    }
    save();
    return out;
  }

  /** Układa role bota na liście serwera tuż pod rolą bota, w kolejności ROLE_ORDER (RZUŁTY najwyżej) */
  async function arrange(rs) {
    const guild = getGuild();
    const botTop = (await guild.members.fetchMe()).roles.highest.position;
    const want = ROLE_ORDER.map((key, i) => ({ role: rs[key].id, position: botTop - 1 - i }));
    if (want.some((w) => w.position < 1)) {
      if (!state.arrangeWarned) {
        console.error('Za mało miejsca pod rolą bota, żeby ułożyć role: przesuń rolę bota wyżej (Ustawienia serwera → Role).');
        state.arrangeWarned = true;
        save();
      }
      return;
    }
    const wrong = ROLE_ORDER.some((key, i) => rs[key].position !== botTop - 1 - i);
    if (wrong) await guild.roles.setPositions(want);
  }

  async function syncRoles() {
    if (Date.now() - (state.rolesAt ?? 0) < ROLES_EVERY_MS) return;
    const guild = getGuild();
    const { links } = await game.links();
    // bez połączonych kont nie tworzymy ról (powstaną przy pierwszym połączeniu)
    if (!links.length && !(state.linkedIds ?? []).length) {
      state.rolesAt = Date.now();
      return;
    }
    const rs = await roles();
    await arrange(rs).catch((e) => console.error('[układ ról]', e.message));
    const all = Object.values(rs);
    const now = new Set(links.map((l) => l.discordId));

    const apply = async (discordId, wanted) => {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) return; // nie ma go na serwerze
      for (const role of all) {
        const has = member.roles.cache.has(role.id);
        const should = wanted.has(role.id);
        if (should && !has) await member.roles.add(role, 'ScamBox: statystyki połączonego konta');
        if (!should && has) await member.roles.remove(role, 'ScamBox: statystyki się zmieniły');
      }
    };

    for (const l of links) {
      await apply(l.discordId, new Set(rolesFor(l).map((key) => rs[key].id)));
    }
    // odłączeni od ostatniej synchronizacji: zabieramy wszystkie role z bota
    for (const old of state.linkedIds ?? []) {
      if (!now.has(old)) await apply(old, new Set());
    }
    state.linkedIds = [...now];
    state.rolesAt = Date.now();
    save();
  }

  /** Przy starcie: role istnieją i są ułożone (widać je i można je przydzielać ręcznie), zanim ktokolwiek połączy konto */
  async function ensureRoles() {
    try {
      await arrange(await roles());
    } catch (e) {
      console.error(`[role] nie utworzono ról: ${e.message}. Bot potrzebuje uprawnienia "Manage Roles" (zaproś go ponownie linkiem z README.md).`);
    }
  }

  return { patch, drops, health, linkReply, syncRoles, ensureRoles };
}

