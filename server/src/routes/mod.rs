//! Adresy gry: strony HTML i API (/api/...). Odpowiedzi API takie same jak w wersji Python - przeglądarka
//! (static/js) działa bez zmian.

pub mod account;
pub mod account_mail;
pub mod admin;
pub mod mail_admin;
pub mod arena;
pub mod backups;
pub mod cards_io;
pub mod casino;
pub mod chess;
pub mod drawings;
pub mod scratch;
pub mod gift;
pub mod horses;
pub mod market;
pub mod passport;
pub mod pinball;
pub mod poker;
pub mod pages;
pub mod aim;
pub mod bot;
pub mod game_rankings;
pub mod quests;
pub mod ctf;
pub mod referral;
pub mod reports;
pub mod radio;
pub mod roles;
pub mod shop;
pub mod events;
pub mod snake;
pub mod themes;
pub mod social;
pub mod variants;

use axum::body::Bytes;
use axum::extract::{FromRequest, Request};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::AppError;
use crate::state::AppState;

/// Treść zapytania (JSON) jako typ `T` - bez względu na Content-Type; pusta treść = `{}`.
pub struct JsonBody<T>(pub T);

impl<T, S> FromRequest<S> for JsonBody<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let bytes = Bytes::from_request(req, state).await.map_err(IntoResponse::into_response)?;
        let json: &[u8] = if bytes.iter().all(u8::is_ascii_whitespace) { b"{}" } else { &bytes };
        serde_json::from_slice(json).map(JsonBody).map_err(|e| {
            tracing::debug!("nieprawidłowa treść zapytania: {e}");
            AppError::bad("Nieprawidłowe żądanie").into_response()
        })
    }
}

/// Odpowiedź JSON
pub fn ok<T: Serialize>(v: T) -> crate::error::Res {
    Ok(Json(v).into_response())
}

pub fn router(st: AppState) -> Router {
    use account::*;
    use admin::*;
    use arena::*;
    use cards_io::*;
    use casino::*;
    use market::*;
    use pages::*;
    use shop::*;
    use social::*;

    let mut r = Router::new()
        // strony
        .route("/login", get(login_page))
        .route("/", get(index))
        .route("/inventory/hall-of-fame", get(index))
        .route("/inventory/figures", get(index))
        .route("/binder/hall-of-fame", get(index))
        .route("/games/figures", get(index))
        .route("/games/pinball", get(index))
        .route("/games/snake", get(index))
        .route("/games/snake3d", get(index))
        .route("/snake/{slot}", get(snake::snake_image))
        .route("/snake/sound/{id}", get(snake::snake_sound))
        .route("/player/{name}", get(index))
        .route("/render/card", get(index))
        .route("/link/{token}", get(index))
        .route("/mockups", get(index))
        // strony prawne i formularz zgłoszeń: dostępne bez logowania (osoba z karty nie musi mieć konta)
        .route("/regulamin", get(public_page))
        .route("/prywatnosc", get(public_page))
        .route("/o-stronie", get(public_page))
        .route("/zglos", get(public_page))
        .route("/manifest.webmanifest", get(manifest))
        .route("/sw.js", get(service_worker))
        .route("/admin", get(admin_page))
        .route("/admin/chess", get(admin_page))
        .route("/admin/reports", get(admin_page))
        .route("/admin/backups", get(admin_page))
        .route("/admin/roles", get(admin_page))
        .route("/admin/radio", get(admin_page))
        .route("/admin/themes", get(admin_page))
        .route("/admin/games", get(admin_page))
        .route("/admin/events", get(admin_page))
        .route("/admin/passport", get(admin_page))
        .route("/admin/referrals", get(admin_page))
        // polecenia: link /r/<kod> działa bez logowania
        .route("/r/{code}", get(referral::ref_landing))
        // quest CTF: strony zadań bez logowania
        .route("/ctf/{token}", get(ctf::ctf_root))
        .route("/ctf/{token}/", get(ctf::ctf_index))
        .route("/ctf/{token}/{*rest}", get(ctf::ctf_page))
        .route("/admin/mockups", get(admin_mockups))
        .route("/flag/{code}", get(flag_image))
        .route("/img/{person_id}", get(image_main))
        .route("/img/{person_id}/{kind}", get(image_kind))
        .route("/avatar/{name}", get(avatar_image))
        .route("/drawing/{id}/{layer}", get(drawings::drawing_image))
        // konta
        .route("/api/register", post(register))
        .route("/api/referral", get(referral::my_referral))
        .route("/api/referral/seen", post(referral::referral_seen))
        .route("/api/referral/claim", get(referral::claim_info).post(referral::claim))
        .route("/api/admin/referrals/mine", post(referral::admin_referral_mine))
        .route("/api/admin/referrals/mine/clear", post(referral::admin_referral_mine_clear))
        .route("/api/referral/invite/{code}", get(referral::ref_invite))
        .route("/api/admin/referrals", get(referral::admin_referrals).post(referral::admin_referral_config))
        .route("/api/admin/referrals/{referred}", post(referral::admin_referral_decide))
        .route("/api/login", post(login))
        .route("/api/logout", post(logout))
        .route("/api/password", post(change_password))
        // email, odzyskiwanie hasła (Supabase Auth); /auth/v1/verify to adres linków z maili
        .route("/api/forgot", post(account::forgot))
        .route("/api/reset", post(account::reset_password))
        .route("/api/resend", post(account::resend))
        .route("/api/email", get(account::email_info).post(account::add_email))
        .route("/auth/v1/verify", get(account::auth_verify))
        .route("/email/{name}", get(account::email_template))
        // maile gry (własny SMTP): reset hasła i zmiana emaila linkami z tokenem; edycja szablonów w panelu admina
        .route("/api/account/reset", post(account_mail::reset_with_token))
        .route("/api/account/password/send-link", post(account_mail::send_link))
        .route("/api/account/email-change/request", post(account_mail::email_change_request))
        .route("/api/account/email-change/confirm", post(account_mail::email_change_confirm))
        .route("/api/account/email-verify", post(account_mail::verify_confirm))
        .route("/api/account/email-verify/resend", post(account_mail::verify_resend))
        .route("/konto/email", get(public_page))
        .route("/konto/potwierdz", get(public_page))
        .route("/api/admin/email-templates", get(mail_admin::admin_email_templates))
        .route("/api/admin/email-templates/{name}", post(mail_admin::admin_email_template_save))
        .route("/api/admin/email-templates/{name}/reset", post(mail_admin::admin_email_template_reset))
        .route("/api/admin/email-templates/{name}/test", post(mail_admin::admin_email_template_test))
        .route("/api/admin/users/{user_id}/email", post(admin_set_email))
        // regulamin i zgłoszenia problemów z kartami
        .route("/api/legal", get(reports::legal))
        .route("/api/terms/accept", post(reports::accept_terms))
        .route("/api/reports", post(reports::report_create))
        .route("/api/admin/reports", get(reports::admin_reports))
        .route("/api/admin/reports/{id}", post(reports::admin_report_update).delete(reports::admin_report_delete))
        // kopie zapasowe bazy: tylko właściciel (OWNER_IDS)
        .route("/api/admin/role", get(roles::admin_role))
        .route("/api/admin/roles", get(roles::roles_list).post(roles::role_save))
        .route("/api/admin/roles/assign", post(roles::role_assign))
        .route("/api/admin/roles/{id}/delete", post(roles::role_delete))
        // motywy czasowe (Niepodległość): terminy, na stałe, wyłączony
        .route("/api/admin/themes", get(themes::admin_themes).post(themes::admin_themes_save))
        // radio (funkcje eksperymentalne): albumy i utwory dodaje admin, gracz tylko słucha
        .route("/api/radio", get(radio::radio_list))
        .route("/radio/file/{id}", get(radio::radio_file))
        .route("/api/admin/radio", get(radio::admin_radio))
        .route("/api/admin/radio/file/{id}", get(radio::admin_radio_file))
        .route("/api/admin/radio/album", post(radio::admin_album_save))
        .route("/api/admin/radio/album/{id}/delete", post(radio::admin_album_delete))
        .route("/api/admin/radio/albums/order", post(radio::admin_albums_order))
        .route("/api/admin/radio/album/{id}/order", post(radio::admin_tracks_order))
        .route("/api/admin/radio/upload", post(radio::admin_track_upload))
        .route("/api/admin/radio/track/{id}", post(radio::admin_track_save))
        .route("/api/admin/radio/track/{id}/delete", post(radio::admin_track_delete))
        .route("/api/admin/backups", get(backups::backups_list).post(backups::backup_create))
        .route("/api/admin/backups/{name}", get(backups::backup_download))
        // skrzynki, kuźnia, codzienna nagroda
        .route("/api/config", get(config))
        .route("/api/state", get(state))
        .route("/api/open", post(open_crates))
        .route("/api/crates/{crate_id}/top-drops", get(crate_top_drops))
        .route("/api/chests/buy", post(buy_chests))
        .route("/api/chests/money", post(open_money_chest))
        .route("/api/sell", post(sell))
        .route("/api/favorite", post(set_favorite))
        .route("/api/contract", post(contract))
        .route("/api/contracts", post(contracts_bulk))
        .route("/api/upgrade", post(upgrade))
        .route("/api/daily", get(daily))
        .route("/api/daily/claim", post(daily_claim))
        // znajomi, aktywność, wymiany, profile
        .route("/api/friends", get(friends))
        .route("/api/friends/request", post(friend_request))
        .route("/api/friends/respond", post(friend_respond))
        .route("/api/friends/remove", post(friend_remove))
        .route("/api/users/search", get(user_search))
        .route("/api/feed", get(feed))
        .route("/api/feed/seen", post(feed_seen))
        .route("/api/show", post(show_card))
        .route("/api/trades", get(trades_list).post(trade_create))
        .route("/api/trades/{tid}/{action}", post(trade_action))
        .route("/api/showcase", post(set_showcase))
        .route("/api/profile", post(set_profile))
        .route("/api/users/{name}", get(profile))
        .route("/api/ranking", get(ranking))
        .route("/api/bot/snapshot", get(bot::snapshot))
        .route("/api/bot/player", get(bot::player))
        .route("/api/bot/drops", get(bot::drops))
        .route("/api/bot/cards", get(bot::cards))
        .route("/api/bot/render-session", post(bot::render_session))
        .route("/api/bot/links", get(bot::links))
        .route("/api/bot/link-code", post(bot::link_code))
        .route("/api/discord", get(bot::discord_status))
        .route("/api/discord/link", post(bot::discord_link))
        .route("/api/discord/unlink", post(bot::discord_unlink))
        .route("/api/me", get(me))
        .route("/api/themes/seen", post(social::themes_seen))
        .route("/api/messages/seen", post(messages_seen))
        .route("/api/halloffame", get(hall_of_fame))
        .route("/api/patchnotes", get(patch_notes))
        .route("/api/patchnotes/seen", post(patch_notes_seen))
        .route("/api/links/{token}/claim", post(link_claim))
        // rynek
        .route("/api/market", get(market))
        .route("/api/market/list", post(market_list))
        .route("/api/market/wanted", post(market_wanted_create))
        .route("/api/market/wanted/{wid}/cancel", post(market_wanted_cancel))
        .route("/api/market/wanted/{wid}/fill", post(market_wanted_fill))
        .route("/api/market/offers/{oid}/{action}", post(market_offer_action))
        .route("/api/market/{lid}/buy", post(market_buy))
        .route("/api/market/{lid}/offer", post(market_offer))
        .route("/api/market/{lid}/bid", post(market_bid))
        .route("/api/market/{lid}/cancel", post(market_cancel))
        // kasyno
        .route("/api/casino/roulette", post(casino_roulette))
        .route("/api/casino/slots", post(casino_slots))
        .route("/api/casino/blackjack", get(casino_blackjack))
        .route("/api/casino/blackjack/deal", post(casino_blackjack_deal))
        .route("/api/casino/blackjack/hit", post(casino_blackjack_hit))
        .route("/api/casino/blackjack/stand", post(casino_blackjack_stand))
        .route("/api/casino/blackjack/double", post(casino_blackjack_double))
        .route("/api/casino/jackpot", get(casino_jackpot).post(casino_jackpot_create))
        .route("/api/casino/jackpot/{jid}/join", post(casino_jackpot_join))
        .route("/api/casino/jackpot/{jid}/leave", post(casino_jackpot_leave))
        .route("/api/casino/jackpot/{jid}/kick", post(casino_jackpot_kick))
        .route("/api/casino/jackpot/{jid}/settings", post(casino_jackpot_settings))
        .route("/api/casino/jackpot/{jid}/cards", post(casino_jackpot_cards))
        .route("/api/casino/jackpot/{jid}/ready", post(casino_jackpot_ready))
        .route("/api/casino/jackpot/{jid}/seen", post(casino_jackpot_seen))
        .route("/api/casino/poker", get(poker::poker_lobby).post(poker::poker_create))
        .route("/api/casino/poker/{tid}", get(poker::poker_table))
        .route("/api/casino/poker/{tid}/join", post(poker::poker_join))
        .route("/api/casino/poker/{tid}/rebuy", post(poker::poker_rebuy))
        .route("/api/casino/poker/{tid}/act", post(poker::poker_act))
        .route("/api/casino/poker/{tid}/leave", post(poker::poker_leave))
        .route("/api/casino/horses", get(horses::casino_horses))
        .route("/api/casino/horses/bet", post(horses::casino_horses_bet))
        .route("/api/casino/horses/bet/{bid}/cancel", post(horses::casino_horses_cancel))
        .route("/api/casino/horses/seen", post(horses::casino_horses_seen))
        .route("/api/casino/horses/solo", post(horses::casino_horses_solo))
        .route("/api/casino/horses/debug", post(horses::casino_horses_debug))
        .route("/api/admin/horses", get(horses::admin_horses).post(horses::admin_horses_save))
        .route("/api/admin/chess-skins", get(chess::admin_skins).post(chess::admin_skins_save))
        .route("/api/admin/quests", get(quests::admin_quests).post(quests::admin_quests_save))
        .route("/api/admin/ctf", get(ctf::admin_ctf).post(ctf::admin_ctf_save))
        .route("/api/quests/ctf", get(ctf::ctf_detail).post(ctf::ctf_submit))
        .route("/api/games/ranking", get(game_rankings::game_ranking))
        .route("/api/passport", get(passport::passport))
        .route("/api/passport/locate", post(passport::locate))
        .route("/api/passport/{code}", get(passport::stamp_holders))
        .route("/passport/icon/{code}", get(passport::icon_image))
        .route("/api/admin/passport", get(passport::admin_passport))
        .route("/api/admin/passport/{code}", post(passport::admin_passport_save))
        .route("/api/admin/passport/{code}/icon", post(passport::admin_passport_icon))
        .route("/api/aim/start", post(aim::aim_start))
        .route("/api/aim/finish", post(aim::aim_finish))
        .route("/api/games/snake", get(snake::snake_config))
        .route("/api/games/snake/start", post(snake::snake_start))
        .route("/api/games/snake/finish", post(snake::snake_finish))
        .route("/api/admin/snake", post(snake::admin_snake_save))
        .route("/api/events", get(events::events_list))
        .route("/api/events/{id}/advent", post(events::advent_claim))
        .route("/api/admin/events", get(events::admin_events).post(events::admin_events_save))
        .route("/api/pinball", get(pinball::pinball_status))
        .route("/api/pinball/start", post(pinball::pinball_start))
        .route("/api/pinball/finish", post(pinball::pinball_finish))
        .route("/api/games/chess", get(chess::chess_lobby))
        .route("/api/games/chess/create", post(chess::chess_create))
        .route("/api/games/chess/test", post(chess::chess_test))
        .route("/api/games/chess/skins", get(chess::chess_skins))
        .route("/api/games/chess/skins/equip", post(chess::chess_skin_equip))
        .route("/api/games/chess/skins/sell", post(chess::chess_skin_sell))
        .route("/api/games/chess/{id}", get(chess::chess_state))
        .route("/api/games/chess/{id}/join", post(chess::chess_join))
        .route("/api/games/chess/{id}/test-step", post(chess::chess_test_step))
        .route("/api/games/chess/{id}/cancel", post(chess::chess_cancel))
        .route("/api/games/chess/{id}/move", post(chess::chess_move))
        .route("/api/games/chess/{id}/resign", post(chess::chess_resign))
        .route("/api/games/chess/{id}/draw", post(chess::chess_draw))
        .route("/api/items/{id}/drawing", get(drawings::drawing_info).post(drawings::drawing_save))
        .route("/api/items/{id}/scratch", post(scratch::scratch_item))
        .route("/api/items/{id}/unwrap", post(gift::unwrap_item))
        .route("/api/items/{id}/rewrap", post(gift::rewrap_item))
        // arena (tylko admini)
        .route("/api/arena/inbox", get(arena_inbox))
        .route("/api/arena/start", post(arena_start))
        .route("/api/arena/battle/{bid}", get(arena_battle))
        .route("/api/arena/battle/{bid}/act", post(arena_act))
        .route("/api/arena/challenge", post(arena_challenge))
        .route("/api/arena/challenge/{cid}/accept", post(arena_accept))
        .route("/api/arena/challenge/{cid}/decline", post(arena_decline))
        // panel admina
        .route("/api/admin/messages", get(admin_messages_list).post(admin_messages_add))
        .route("/api/admin/messages/{mid}", delete(admin_messages_delete))
        .route("/api/admin/log", get(admin_log_list))
        .route("/api/admin/catalog", get(admin_catalog))
        .route("/api/admin/crates", post(admin_save_crate))
        .route("/api/admin/shop-size", post(admin_shop_size))
        .route("/api/admin/crates/{cid}", delete(admin_delete_crate))
        .route("/api/admin/crates/{cid}/restore", post(admin_restore_crate))
        .route("/api/admin/crates/{cid}/test-open", post(admin_test_open))
        .route("/api/admin/crates/{cid}/clear", post(admin_clear_crate))
        .route("/api/admin/cards", post(admin_save_card))
        .route("/api/admin/cards/export", post(admin_export_cards))
        .route("/api/admin/cards/template", get(admin_cards_template))
        .route("/api/admin/cards/import", post(admin_import_cards))
        .route("/api/admin/cards/{pid}", delete(admin_delete_card))
        .route("/api/admin/cards/{pid}/restore", post(admin_restore_card))
        .route("/api/admin/cards/{pid}/refetch", post(admin_refetch))
        .route("/api/admin/links", get(admin_links).post(admin_link_create))
        .route("/api/admin/links/{link_id}", post(admin_link_toggle))
        .route("/api/admin/users", get(admin_users))
        .route("/api/admin/users/{user_id}", delete(admin_delete_user))
        .route("/api/admin/users/{user_id}/ban", post(admin_ban))
        .route("/api/admin/users/{user_id}/ranking", post(admin_ranking_hidden))
        .route("/api/admin/users/{user_id}/cards", get(admin_user_cards))
        .route("/api/admin/users/{user_id}/cards/delete", post(admin_delete_user_cards))
        .route("/api/admin/users/{user_id}/access", post(admin_set_access))
        .route("/api/admin/users/{user_id}/chests", post(admin_give_chests))
        .route("/api/admin/users/{user_id}/money", post(admin_money))
        .route("/api/admin/users/{user_id}/admin", post(admin_toggle))
        .route("/api/admin/users/{user_id}/reset-link", post(admin_reset_link))
        // osiągnięcia
        .route("/api/users/{name}/achievements", get(crate::achievements::user_achievements))
        .route("/api/achievements/pop", post(crate::achievements::achievements_pop))
        .route(
            "/api/admin/achievements",
            get(crate::achievements::admin_achievements).post(crate::achievements::admin_achievement_save),
        )
        .route("/api/admin/achievements/{aid}/delete", post(crate::achievements::admin_achievement_delete))
        // warianty: ustawienia, wydarzenia, kreator, naklejki; easter eggi
        .route("/sticker/{variant}/{sid}", get(variants::sticker_image))
        .route("/egg", get(variants::egg_image))
        .route("/api/ufo/seen", post(variants::ufo_seen))
        .route("/api/admin/egg", post(variants::admin_egg_save))
        .route("/api/admin/ufo/test", post(variants::admin_ufo_test))
        .route("/api/admin/variants/{variant}", post(variants::admin_variant_save))
        .route("/api/admin/variants/{variant}/crates", post(variants::admin_variant_crate))
        .route("/api/admin/variants/{variant}/events", post(variants::admin_variant_event_add))
        .route("/api/admin/variants/{variant}/events/{eid}/delete", post(variants::admin_variant_event_delete))
        .route("/api/admin/variant-designs", post(variants::admin_variant_design_save))
        .route("/api/admin/variant-designs/{key}/delete", post(variants::admin_variant_design_delete))
        .route("/api/admin/stickers/{variant}", get(variants::admin_stickers_get).post(variants::admin_stickers_save))
        .route("/api/admin/stickers/{variant}/upload", post(variants::admin_sticker_upload))
        .route("/api/admin/stickers/{variant}/card/{pid}", post(variants::admin_card_stickers_save));
    for view in pages::VIEWS {
        r = r.route(&format!("/{view}"), get(index));
    }
    // uprawnienia rang adminów sprawdza jedna warstwa (roles::need), nie każdy handler z osobna
    r.with_state(st.clone()).layer(axum::middleware::from_fn_with_state(st, roles::gate))
}
