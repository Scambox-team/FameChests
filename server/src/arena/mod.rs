//! Arena: mecze 1v1 i trening z komputerem w pamięci procesu (restart serwera kończy trwające mecze), wyzwania między
//! graczami. Jeden wspólny zamek na całą Arenę - ruchy liczą się po kolei. Zasady meczu: `engine.rs`, ustawienia
//! i statystyki kart: `rules.rs`.

pub mod engine;
pub mod rules;
pub mod view;

use indexmap::IndexMap;
use serde::Serialize;

use crate::auth::UserView;
use crate::db::now;
pub use engine::{DeckCard, Game, Mode, Side};

pub const CHALLENGE_SECONDS: f64 = 120.0; // wyzwanie bez odpowiedzi wygasa
pub const KEEP_FINISHED: f64 = 10.0 * 60.0; // zakończony mecz zostaje w pamięci (wynik, nagrody) jeszcze 10 minut
pub const AWAY_SECONDS: f64 = 90.0; // gracz bez kontaktu z serwerem tak długo przegrywa walkowerem

/// Portret gracza w meczu
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum Hero {
    Player(HeroUser),
    Bot { username: &'static str, bot: bool },
}

impl Hero {
    pub fn computer() -> Hero {
        Hero::Bot { username: "Komputer", bot: true }
    }
}

/// Gracz bez informacji, czy jest adminem
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeroUser {
    pub id: i64,
    pub username: String,
    pub avatar: String,
    pub avatar_card: Option<String>,
    pub avatar_rarity: Option<String>,
    pub avatar_variant: Option<String>,
}

impl From<UserView> for Hero {
    fn from(u: UserView) -> Hero {
        Hero::Player(HeroUser {
            id: u.id,
            username: u.username,
            avatar: u.avatar,
            avatar_card: u.avatar_card,
            avatar_rarity: u.avatar_rarity,
            avatar_variant: u.avatar_variant,
        })
    }
}

/// Nagroda za mecz: grosze, wygrane dziś (z ludźmi / z botem) i dzienne limity
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Reward {
    pub money: i64,
    pub exp: bool,
    pub pvp_wins: i64,
    pub bot_wins: i64,
    pub daily_pvp: i64,
    pub daily_bot: i64,
    pub reward_pvp: i64,
    pub reward_bot: i64,
    /// dlaczego bez nagrody (np. limit dnia, za krótki mecz)
    pub note: Option<String>,
}

impl Reward {
    pub fn today(pvp_wins: i64, bot_wins: i64) -> Reward {
        let s = rules::data().settings.clone();
        Reward {
            pvp_wins,
            bot_wins,
            daily_pvp: s.daily_pvp,
            daily_bot: s.daily_bot,
            reward_pvp: s.reward_pvp,
            reward_bot: s.reward_bot,
            ..Reward::default()
        }
    }
}

/// Trwający mecz
pub struct Battle {
    pub id: String,
    pub game: Game,
    pub heroes: [Hero; 2],
    pub users: [Option<i64>; 2],
    pub rewards: [Option<Reward>; 2],
    pub recorded: bool,
    pub seen: [f64; 2],
    pub created: f64,
}

impl Battle {
    pub fn new(id: String, game: Game, heroes: [Hero; 2], users: [Option<i64>; 2]) -> Battle {
        let t = now();
        Battle { id, game, heroes, users, rewards: [None, None], recorded: false, seen: [t, t], created: t }
    }

    pub fn side_of_user(&self, uid: i64) -> Option<Side> {
        Side::BOTH.into_iter().find(|s| self.users[s.idx()] == Some(uid))
    }

    pub fn user_of(&self, s: Side) -> Option<i64> {
        self.users[s.idx()]
    }

    pub fn touch_seen(&mut self, s: Side) {
        self.seen[s.idx()] = now();
    }

    /// Upływ czasu, ruchy komputera, walkower za brak kontaktu
    pub fn advance(&mut self) {
        let t = now();
        for _ in 0..50 {
            self.game.tick(t);
            if self.game.over.is_some() {
                break;
            }
            let active = self.game.active;
            if self.users[active.idx()].is_none() {
                self.game.bot_turn(active, t);
                continue;
            }
            break;
        }
        if self.game.over.is_none() && self.game.mode == Mode::Pvp {
            for s in Side::BOTH {
                if t - self.seen[s.idx()] > AWAY_SECONDS {
                    self.game.finish(engine::Outcome::Won(s.other()), engine::EndReason::Away, t);
                    break;
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChallengeStatus {
    Pending,
    Accepted,
    Declined,
    Cancelled,
    Expired,
}

pub struct Challenge {
    pub id: String,
    pub from: i64,
    pub to: i64,
    pub from_user: Hero,
    pub to_user: Hero,
    pub deck: Vec<DeckCard>,
    pub status: ChallengeStatus,
    pub created: f64,
    pub battle: Option<String>,
}

#[derive(Serialize)]
pub struct ChallengeView<'a> {
    id: &'a str,
    from: &'a Hero,
    to: &'a Hero,
    status: ChallengeStatus,
    battle: Option<&'a str>,
    /// sekundy do wygaśnięcia
    left: i64,
}

impl Challenge {
    pub fn view(&self) -> ChallengeView<'_> {
        ChallengeView {
            id: &self.id,
            from: &self.from_user,
            to: &self.to_user,
            status: self.status,
            battle: self.battle.as_deref(),
            left: ((CHALLENGE_SECONDS - (now() - self.created)).round_ties_even() as i64).max(0),
        }
    }
}

#[derive(Default)]
pub struct Arena {
    pub battles: IndexMap<String, Battle>,
    pub challenges: IndexMap<String, Challenge>,
}

#[derive(Default)]
pub struct ArenaState {
    pub inner: tokio::sync::Mutex<Arena>,
}

/// Losowy identyfikator (jak secrets.token_urlsafe(9))
pub fn token() -> String {
    use base64::Engine;
    let bytes: [u8; 9] = rand::random();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

impl Arena {
    /// Usuwa stare mecze i wyzwania. Mecze nie kończą się tutaj (nagrody zapisuje `routes/arena.rs`), tylko znikają
    /// zakończone dawno temu i porzucone ponad godzinę.
    pub fn cleanup(&mut self) {
        let t = now();
        self.battles.retain(|_, b| {
            let old = b.game.finished_at.is_some_and(|f| t - f > KEEP_FINISHED);
            let abandoned = t - b.seen[0].max(b.seen[1]) > 3600.0;
            !old && !abandoned
        });
        for c in self.challenges.values_mut() {
            if c.status == ChallengeStatus::Pending && t - c.created > CHALLENGE_SECONDS {
                c.status = ChallengeStatus::Expired;
            }
        }
        self.challenges.retain(|_, c| t - c.created <= KEEP_FINISHED);
    }

    /// Trwający mecz gracza (najnowszy)
    pub fn active_battle(&self, user: i64) -> Option<&Battle> {
        self.battles
            .values()
            .filter(|b| b.game.over.is_none() && b.side_of_user(user).is_some())
            .max_by(|a, b| a.created.total_cmp(&b.created))
    }

    pub fn new_challenge(&mut self, from: i64, to: i64, from_user: Hero, to_user: Hero, deck: Vec<DeckCard>) -> &Challenge {
        self.cleanup();
        for c in self.challenges.values_mut().filter(|c| c.status == ChallengeStatus::Pending && c.from == from) {
            c.status = ChallengeStatus::Cancelled; // nowe wyzwanie zastępuje poprzednie
        }
        let c = Challenge {
            id: token(),
            from,
            to,
            from_user,
            to_user,
            deck,
            status: ChallengeStatus::Pending,
            created: now(),
            battle: None,
        };
        let id = c.id.clone();
        self.challenges.entry(id).or_insert(c)
    }

    /// (przychodzące wyzwania, moje ostatnie wyzwanie)
    pub fn challenges_for(&mut self, user: i64) -> (Vec<ChallengeView<'_>>, Option<ChallengeView<'_>>) {
        self.cleanup();
        let incoming = self
            .challenges
            .values()
            .filter(|c| c.to == user && c.status == ChallengeStatus::Pending)
            .map(Challenge::view)
            .collect();
        let outgoing = self
            .challenges
            .values()
            .filter(|c| c.from == user)
            .max_by(|a, b| a.created.total_cmp(&b.created))
            .map(Challenge::view);
        (incoming, outgoing)
    }
}
