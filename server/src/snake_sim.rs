//! Snake 2D po stronie serwera: port `web/src/features/snake/core.ts` (ten sam porządek działań i losowań). Serwer odtwarza
//! grę z ziarna i zapisu zmian kierunku, sam liczy jabłka i najkrótszy możliwy czas gry, więc wyniku z przeglądarki nie
//! bierze na słowo. Zmieniając rdzeń w jednym miejscu, zmień go w drugim i odtwórz nagrania
//! (`node web/scripts/snake-fixture.mjs`, test `cargo test snake_sim`).

use crate::det::Rng;

const COLS: i32 = 20;
const ROWS: i32 = 20;
const START_MS: f64 = 140.0;
const MIN_MS: f64 = 65.0;
const FASTER: f64 = 3.0;
/// kierunki w kolejności kodów z zapisu: prawo, dół, lewo, góra
const VEC: [(i32, i32); 4] = [(1, 0), (0, 1), (-1, 0), (0, -1)];
/// najdłuższa gra (kroków) - po niej odtwarzanie się poddaje
const MAX_STEPS: u64 = 400_000;
const MAX_EVENTS: usize = 100_000;

pub struct Outcome {
    /// zjedzone jabłka
    pub score: i64,
    pub steps: u64,
    /// suma czasów kroków (ms): krócej gra trwać nie mogła
    pub min_ms: f64,
}

fn place_apple(rng: &mut Rng, snake: &[(i32, i32)]) -> (i32, i32) {
    let mut free = Vec::new();
    for y in 0..ROWS {
        for x in 0..COLS {
            if !snake.contains(&(x, y)) {
                free.push((x, y));
            }
        }
    }
    if free.is_empty() {
        return (-1, -1);
    }
    free[(rng.next() * free.len() as f64).floor() as usize]
}

/// Odtwarza grę: `log` = naprzemiennie numer kroku i kod kierunku (0-3). None = zapis nie do przyjęcia.
pub fn replay(seed: u32, log: &[u64]) -> Option<Outcome> {
    if !log.len().is_multiple_of(2) || log.len() / 2 > MAX_EVENTS {
        return None;
    }
    let mut rng = Rng::new(seed);
    let y = ROWS / 2;
    let mut snake = vec![(6, y), (5, y), (4, y)];
    let mut apple = place_apple(&mut rng, &snake);
    let (mut dir, mut score, mut step_ms, mut steps, mut min_ms) = (0usize, 0i64, START_MS, 0u64, 0.0f64);
    let mut ev = 0;
    loop {
        // zmiany kierunku zapisane na ten krok (kolejno; numery kroków nie mogą maleć)
        while ev < log.len() && log[ev] == steps {
            let code = log[ev + 1];
            if code > 3 {
                return None;
            }
            dir = code as usize;
            ev += 2;
        }
        if ev < log.len() && log[ev] < steps {
            return None;
        }
        min_ms += step_ms;
        steps += 1;
        if steps > MAX_STEPS {
            return None;
        }
        let (h, v) = (snake[0], VEC[dir]);
        let n = (h.0 + v.0, h.1 + v.1);
        let eats = n == apple;
        let body = if eats { &snake[..] } else { &snake[..snake.len() - 1] };
        if n.0 < 0 || n.1 < 0 || n.0 >= COLS || n.1 >= ROWS || body.contains(&n) {
            break;
        }
        snake.insert(0, n);
        if eats {
            score += 1;
            step_ms = MIN_MS.max(step_ms - FASTER);
            apple = place_apple(&mut rng, &snake);
            if apple.0 < 0 {
                break;
            }
        } else {
            snake.pop();
        }
    }
    Some(Outcome { score, steps, min_ms })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Rec {
        seed: u32,
        log: Vec<u64>,
        score: i64,
        steps: u64,
    }

    #[test]
    fn server_replays_match_the_browser() {
        let fixtures: Vec<Rec> = serde_json::from_str(include_str!("../tests/fixtures/snake_replays.json")).unwrap();
        assert!(!fixtures.is_empty());
        for f in fixtures {
            let o = replay(f.seed, &f.log).expect("zapis");
            assert_eq!((o.score, o.steps), (f.score, f.steps), "ziarno {}", f.seed);
        }
    }

    #[test]
    fn going_straight_hits_the_wall() {
        let o = replay(1, &[]).unwrap();
        assert_eq!(o.steps, 14); // od x = 6 do ściany (x = 20)
        assert!(replay(1, &[5]).is_none());
        assert!(replay(1, &[3, 9]).is_none());
    }
}
