//! Losowanie: rzadkość i karta ze skrzynki, wariant karty, wygrane w kasynie (karty o zadanej wartości).

use std::collections::HashMap;
use std::sync::Arc;

use rand::seq::SliceRandom;
use rand::Rng;

use crate::catalog::{Catalog, Crate, Person};
use crate::data::{combine_variant, g};

/// random.choices(population, weights)[0] - indeks albo None (suma wag <= 0)
pub fn choose_weighted(weights: &[f64]) -> Option<usize> {
    let total: f64 = weights.iter().sum();
    if total <= 0.0 || weights.is_empty() {
        return None;
    }
    let r = rand::thread_rng().gen::<f64>() * total;
    let mut acc = 0.0;
    for (i, w) in weights.iter().enumerate() {
        acc += w;
        if r < acc {
            return Some(i);
        }
    }
    weights.iter().rposition(|w| *w > 0.0)
}

pub fn random() -> f64 {
    rand::thread_rng().gen()
}

/// Wariant karty. avail = warianty, które mogą teraz wypaść (Catalog::drop_variants dla skrzynki,
/// Catalog::base_variants dla kontraktu), boost = {wariant: mnożnik szansy} z trwających wydarzeń (strona /variants).
/// Wariant-warstwa (flaga) z szansą "extraChance" dostaje jeszcze jeden wariant - z tymi samymi szansami co zwykle.
/// Warianty "always" (halloweenowe): w tej skrzynce każda karta dostaje jeden z nich (według "weight"), a zwykły
/// wariant losuje się normalnie - chyba że wylosowany ma "noCombo": wtedy karta ma tylko ten wariant.
pub fn roll_variant(avail: &[String], boost: &HashMap<String, f64>, factor: f64) -> String {
    let g = g();
    let b = |v: &str| boost.get(v).copied().unwrap_or(1.0);
    let always: Vec<&String> = avail.iter().filter(|v| g.variant(v).always).collect();
    if !always.is_empty() {
        let weights: Vec<f64> = always.iter().map(|v| g.variant(v).weight.unwrap_or(1.0) * b(v)).collect();
        let layer = always[choose_weighted(&weights).unwrap_or(0)];
        if g.variant(layer).no_combo {
            return layer.clone();
        }
        // bez warstw i bez "always" (inaczej rekurencja bez końca, gdy "always" nie jest warstwą - np. chesswhite)
        let rest: Vec<String> = avail.iter().filter(|v| !g.variant(v).layer && !g.variant(v).always).cloned().collect();
        return combine_variant(layer, &roll_variant(&rest, boost, factor));
    }
    let chance = |v: &str| g.variant(v).chance * b(v);
    // najrzadsze najpierw
    let specials: Vec<&String> = g.variant_order.iter().rev().filter(|v| avail.contains(v)).collect();
    let total: f64 = specials.iter().map(|v| chance(v)).sum();
    let factor = if total != 0.0 { factor.min(0.9 / total) } else { factor };
    let mut rng = rand::thread_rng();
    let r: f64 = rng.gen();
    let mut acc = 0.0;
    for v in &specials {
        let x = g.variant(v);
        acc += chance(v) * factor;
        if r < acc {
            if x.layer && rng.gen::<f64>() < x.extra_chance {
                let bases: Vec<&&String> = specials.iter().filter(|b| !g.variant(b).layer).collect();
                let weights: Vec<f64> = bases.iter().map(|b| chance(b)).collect();
                if let Some(i) = choose_weighted(&weights) {
                    return combine_variant(v, bases[i]);
                }
            }
            return (*v).clone();
        }
    }
    "normal".into()
}

/// Karta i wariant ze skrzynki (karty specjalne nie wypadają ze skrzynek). None: wszystkie wagi zerowe.
pub fn roll(cat: &Catalog, cr: &Crate) -> Option<(Arc<Person>, String)> {
    let g = g();
    let people: Vec<&Arc<Person>> = cat.crate_people(cr).collect();
    let present: std::collections::HashSet<&str> = people.iter().filter(|p| !p.is_special()).map(|p| p.rarity.as_str()).collect();
    let weights: Vec<f64> =
        g.rarity_order.iter().map(|r| if present.contains(r.as_str()) { cr.weight(r) } else { 0.0 }).collect();
    let rarity = &g.rarity_order[choose_weighted(&weights)?];
    let pool: Vec<&&Arc<Person>> = people.iter().filter(|p| &p.rarity == rarity).collect();
    let person = (**pool.choose(&mut rand::thread_rng())?).clone();
    let (avail, boost) = cat.drop_variants(cr, Some(&person));
    let variant = roll_variant(&avail, &boost, 1.0);
    Some((person, variant))
}

/// Rozkład prawdopodobieństwa wariantów - dokładnie to, co losuje `roll_variant` (te same reguły), do wyliczeń (zwrot skrzynki).
pub fn variant_dist(avail: &[String], boost: &HashMap<String, f64>, factor: f64) -> Vec<(String, f64)> {
    let g = g();
    let b = |v: &str| boost.get(v).copied().unwrap_or(1.0);
    let always: Vec<&String> = avail.iter().filter(|v| g.variant(v).always).collect();
    if !always.is_empty() {
        let weights: Vec<f64> = always.iter().map(|v| g.variant(v).weight.unwrap_or(1.0) * b(v)).collect();
        let total: f64 = weights.iter().sum();
        // jak w roll_variant: bez warstw i bez "always" (inaczej rekurencja bez końca)
        let rest: Vec<String> = avail.iter().filter(|v| !g.variant(v).layer && !g.variant(v).always).cloned().collect();
        // rozkład zwykłych wariantów liczymy tylko, gdy któryś "always" go potrzebuje (nie ma "noCombo")
        let sub = if always.iter().any(|v| !g.variant(v).no_combo) { variant_dist(&rest, boost, factor) } else { Vec::new() };
        let mut out = Vec::new();
        for (i, layer) in always.iter().enumerate() {
            let pl = if total > 0.0 { weights[i] / total } else if i == 0 { 1.0 } else { 0.0 };
            if pl == 0.0 {
                continue;
            }
            if g.variant(layer).no_combo {
                out.push(((*layer).clone(), pl));
            } else {
                out.extend(sub.iter().map(|(v, q)| (combine_variant(layer, v), pl * q)));
            }
        }
        return out;
    }
    let chance = |v: &str| g.variant(v).chance * b(v);
    let specials: Vec<&String> = g.variant_order.iter().rev().filter(|v| avail.contains(v)).collect();
    let total: f64 = specials.iter().map(|v| chance(v)).sum();
    let factor = if total != 0.0 { factor.min(0.9 / total) } else { factor };
    let mut out = Vec::new();
    let mut taken = 0.0;
    for v in &specials {
        let x = g.variant(v);
        let pv = (chance(v) * factor).min(1.0 - taken).max(0.0);
        taken += pv;
        if pv <= 0.0 {
            continue;
        }
        if x.layer && x.extra_chance > 0.0 {
            let bases: Vec<&&String> = specials.iter().filter(|b| !g.variant(b).layer).collect();
            let weights: Vec<f64> = bases.iter().map(|b| chance(b)).collect();
            let wt: f64 = weights.iter().sum();
            if wt > 0.0 {
                out.push(((*v).clone(), pv * (1.0 - x.extra_chance)));
                for (i, bs) in bases.iter().enumerate() {
                    out.push((combine_variant(v, bs), pv * x.extra_chance * weights[i] / wt));
                }
                continue;
            }
        }
        out.push(((*v).clone(), pv));
    }
    if taken < 1.0 {
        out.push(("normal".into(), 1.0 - taken));
    }
    out
}

/// Współczynnik zwrotu skrzynki: oczekiwana wartość jednej wylosowanej karty (z wariantami) / cena skrzynki.
/// 1.0 = 100% (średnio oddaje tyle, ile kosztuje). None, gdy skrzynka nic nie losuje.
pub fn crate_return(cat: &Catalog, cr: &Crate) -> Option<f64> {
    let g = g();
    let people: Vec<&Arc<Person>> = cat.crate_people(cr).filter(|p| !p.is_special()).collect();
    let weights: Vec<f64> = g
        .rarity_order
        .iter()
        .map(|r| if people.iter().any(|p| &p.rarity == r) { cr.weight(r) } else { 0.0 })
        .collect();
    let total: f64 = weights.iter().sum();
    if total <= 0.0 || cr.price <= 0 {
        return None;
    }
    let mut ev = 0.0;
    for (i, r) in g.rarity_order.iter().enumerate() {
        if weights[i] <= 0.0 {
            continue;
        }
        let pool: Vec<&&Arc<Person>> = people.iter().filter(|p| &p.rarity == r).collect();
        let mut mean = 0.0;
        for p in &pool {
            let (avail, boost) = cat.drop_variants(cr, Some(p));
            let e: f64 = variant_dist(&avail, &boost, 1.0).iter().map(|(v, q)| q * p.value(v) as f64).sum();
            mean += e / pool.len() as f64;
        }
        ev += weights[i] / total * mean;
    }
    Some(ev / cr.price as f64)
}

/// Pieniądze ze skrzynki z pieniędzmi: min + (max - min) * los^curve, zaokrąglone do 100 gr
pub fn roll_money(kind: &str) -> i64 {
    let c = &g().money_chests[kind];
    let amount = c.min as f64 + (c.max - c.min) as f64 * random().powf(c.curve);
    ((amount / 100.0).round_ties_even() as i64) * 100
}

/// Euro ze skrzynki z pieniędzmi (0, gdy skrzynka ich nie daje): euro_min + (euro_max - euro_min) * los^curve, zaokrąglone do 10
pub fn roll_euro(kind: &str) -> i64 {
    let c = &g().money_chests[kind];
    if c.euro_max <= 0 {
        return 0;
    }
    let amount = c.euro_min as f64 + (c.euro_max - c.euro_min).max(0) as f64 * random().powf(c.curve);
    (((amount / 10.0).round_ties_even() as i64) * 10).clamp(c.euro_min, c.euro_max)
}

/// Wygrana w kartach o łącznej wartości value: losowe karty ze skrzynek w sklepie (bez tajnych) w wariantach
/// z CASINO_VARIANTS - za każdym razem jedna z najdroższych, które się mieszczą (CASINO_TOP).
/// Zwraca ([(karta, wariant)], reszta w pieniądzach).
pub fn house_cards(cat: &Catalog, value: i64) -> (Vec<(Arc<Person>, String)>, i64) {
    let g = g();
    let pool = house_pool(cat, &g);
    house_pick(&g, pool, value)
}

/// Pula kasyna: (wartość, karta, wariant) dla kart z kuźni w wariantach z CASINO_VARIANTS i w wariantach przypiętych do tej karty; od najdroższych.
/// Dane gry podane jawnie (test nie zależy od globalnego stanu, który zmieniają inne testy).
pub fn house_pool<'a>(cat: &'a Catalog, g: &crate::data::GameData) -> Vec<(i64, &'a Arc<Person>, String)> {
    // CASINO_VARIANTS: zwykła i warianty włączone (albo z "extraSource": "casino", np. Zdrapka - wypada z kasyna także
    // wyłączona, gdy jej wartość pasuje do puli), nie zablokowane przez admina w kasynie
    let casino: Vec<String> = g
        .casino_variants
        .iter()
        .filter(|v| {
            // warianty przypięte do kart ("cards", także z panelu) są tylko dla swoich kart: dokłada je `house_extra` (jak w base_variants)
            *v == "normal"
                || (g.variant(v).cards.is_empty()
                    && (cat.variant_enabled(v) || g.variant(v).extra_source.as_deref() == Some("casino"))
                    && cat.variant_house_ok(v))
        })
        .cloned()
        .collect();
    let mut pool: Vec<(i64, &Arc<Person>, String)> = cat
        .people
        .values()
        .filter(|p| p.forge && !p.is_secret())
        .flat_map(|p| casino.iter().cloned().chain(cat.house_extra_in(g, p)).map(move |v| (p.value(&v), p, v)))
        .collect();
    pool.sort_by_key(|x| -x.0); // stabilne, jak sorted()
    pool
}

fn house_pick(g: &crate::data::GameData, pool: Vec<(i64, &Arc<Person>, String)>, value: i64) -> (Vec<(Arc<Person>, String)>, i64) {
    let (mut out, mut left) = (vec![], value);
    let mut rng = rand::thread_rng();
    while out.len() < g.roulette.max_payout_cards {
        let fit: Vec<&(i64, &Arc<Person>, String)> = pool.iter().filter(|x| x.0 <= left).collect();
        let Some(top) = fit.first() else { break };
        let limit = top.0 as f64 * g.casino_top;
        let best: Vec<&&(i64, &Arc<Person>, String)> = fit.iter().filter(|x| x.0 as f64 >= limit).collect();
        let Some(pick) = best.choose(&mut rng) else { break };
        out.push(((*pick.1).clone(), pick.2.clone()));
        left -= pick.0;
    }
    (out, left)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variants_and_payouts() {
        let cat = crate::catalog::build(&[], &[]);
        let none = HashMap::new();
        let base = cat.base_variants();
        for _ in 0..2000 {
            let v = roll_variant(&base, &none, 1.0);
            assert!(!g().variants[&v].exclusive, "{v}");
        }
        let mut hw = vec!["halloween".to_string(), "lantern".to_string(), "devil".to_string()];
        hw.extend(base.iter().cloned());
        for _ in 0..500 {
            let v = roll_variant(&hw, &none, 1.0);
            assert!(v == "lantern" || v == "devil" || v.starts_with("halloween"), "{v}");
        }
        // skrzynka: tylko warianty, które mogą wypaść (bez nich - same zwykłe karty)
        for _ in 0..2000 {
            assert_eq!(roll_variant(&[], &none, 1.0), "normal");
            let v = roll_variant(&["gold".to_string()], &none, 1.0);
            assert!(v == "normal" || v == "gold", "{v}");
        }
        let (cards, money) = house_cards(&cat, 12_345);
        let total: i64 = cards.iter().map(|(p, v)| p.value(v)).sum::<i64>() + money;
        assert_eq!(total, 12_345);
        assert!(money >= 0);
        let (p, _) = roll(&cat, &cat.crates["pl"]).unwrap();
        assert!(p.crates.contains(&"pl".to_string()));
        assert!(roll(&cat, &cat.crates["specjalne"]).is_none());
        for _ in 0..100 {
            let m = roll_money("daily");
            assert!((5_000..=20_000).contains(&m) && m % 100 == 0);
        }
        // euro: tylko MEGA skrzynka (250-1000), codzienna ich nie daje
        for _ in 0..200 {
            let e = roll_euro("mega");
            assert!((250..=1000).contains(&e) && e % 10 == 0, "{e}");
            assert_eq!(roll_euro("daily"), 0);
        }
    }

    #[test]
    fn euro_is_worth_more_than_gr() {
        use crate::game::{euro_for_gr, euro_from_ratio};
        assert_eq!(euro_from_ratio(0, 0.02), 0);
        assert_eq!(euro_from_ratio(10, 0.02), 1, "najmniej 1 euro przy dodatniej nagrodzie");
        assert_eq!(euro_from_ratio(500, 0.02), 10);
        for gr in [1, 50, 300, 2_000, 100_000] {
            assert!(euro_for_gr(gr) < gr || gr == 1, "z tego samego miejsca euro jest mniej niż groszy: {gr}");
        }
        assert!(g().euro.ratio > 0.0 && g().euro.ratio < 0.5);
    }

    /// "always" bez warstwy (chesswhite/chessblack) nie może zapętlać rozkładu ani losowania; rozkład sumuje się do 1
    #[test]
    fn always_non_layer_variants_terminate() {
        let none = HashMap::new();
        for chess in ["chesswhite", "chessblack"] {
            let avail: Vec<String> = ["bw", "gold", "holo", "silver", chess, "blank"].iter().map(|s| s.to_string()).collect();
            let dist = variant_dist(&avail, &none, 1.0);
            let sum: f64 = dist.iter().map(|(_, q)| q).sum();
            assert!((sum - 1.0).abs() < 1e-9, "{chess}: suma {sum}");
            assert!(dist.iter().all(|(v, _)| v == chess), "{chess}: {dist:?}");
            for _ in 0..200 {
                assert_eq!(roll_variant(&avail, &none, 1.0), chess);
            }
        }
        // warstwa "always" (halloween) nadal łączy się ze zwykłym wariantem, rozkład sumuje się do 1
        let cat = crate::catalog::build(&[], &[]);
        let mut hw = vec!["halloween".to_string()];
        hw.extend(cat.base_variants());
        let sum: f64 = variant_dist(&hw, &none, 1.0).iter().map(|(_, q)| q).sum();
        assert!((sum - 1.0).abs() < 1e-9, "halloween: suma {sum}");
    }

    /// Ustawienia z panelu (jak na stronie /variants: `cards`, `crateOnly`, włączony) nałożone na dane gry - jawnie, bez ruszania globalnego stanu
    fn panel_game(variant: &str, cards: &[&str], crate_only: bool) -> (Catalog, crate::data::GameData) {
        let row = (variant.to_owned(), serde_json::json!({"settings": {"enabled": true, "cards": cards, "crateOnly": crate_only}}).as_object().cloned().unwrap());
        let rows = [row];
        let cat = crate::catalog::build_with_variants(&[], &[], &rows);
        let vs = crate::variants::VariantState::read(&rows, Default::default());
        (cat, crate::data::base_game().with_catalog_variants(&vs.custom, &vs.cfg))
    }

    /// Wariant z listą kart (ekskluzywny dla karty) wypada TYLKO tym kartom, także w kasynie, kontrakcie i ulepszaczu.
    /// Błąd: `casino_variants` brał każdy wariant z szansą > 0, także przypięty do karty w panelu, a `house_cards` dawał go WSZYSTKIM kartom
    /// (pula kasyna nie filtrowała po liście kart; kontrakt i ulepszacz były bezpieczne, bo biorą `base_variants` + `house_extra(karta)`).
    #[test]
    fn card_bound_variant_never_drops_for_other_cards() {
        let probe = crate::catalog::build(&[], &[]);
        let mut forge: Vec<String> = probe.people.values().filter(|p| p.forge && !p.is_secret() && !p.is_special()).map(|p| p.id.clone()).collect();
        forge.sort();
        let (a, b) = (forge[0].clone(), forge[1].clone());
        for variant in ["gold", "silver", "holo"] {
            for crate_only in [false, true] {
                let (cat, gd) = panel_game(variant, &[a.as_str()], crate_only);
                let x = gd.variant(variant);
                assert_eq!(x.cards, vec![a.clone()], "ustawienie z panelu trafia do danych gry");
                assert!(x.chance > 0.0 && !x.exclusive, "{variant}: wariant z szansą i nie wyjątkowy - dokładnie ten przypadek");
                // dane gry: wariant przypięty do karty nie jest wariantem kasyna
                assert!(!gd.casino_variants.iter().any(|v| v == variant), "{variant}: casino_variants");
                assert!(gd.casino_variants.iter().any(|v| v == "normal"));
                // pula kasyna: wariant tylko przy własnej karcie (i tylko bez crateOnly)
                let pool = house_pool(&cat, &gd);
                for (_, p, v) in &pool {
                    if v.split('+').any(|x| x == variant) {
                        assert_eq!(p.id, a, "{variant} (crateOnly={crate_only}) w puli kasyna przy karcie {}", p.id);
                    }
                }
                let own = pool.iter().any(|(_, p, v)| p.id == a && v == variant);
                assert_eq!(own, !crate_only, "{variant}: własna karta w kasynie (crateOnly={crate_only})");
                assert!(pool.iter().any(|(_, p, v)| p.id == b && v == "normal"), "inne karty nadal są w kasynie w zwykłym wariancie");
                // wypłata: wielokrotnie, różne wartości
                for value in [200, 5_000, 100_000, 3_000_000] {
                    for _ in 0..40 {
                        let (drawn, _) = house_pick(&gd, house_pool(&cat, &gd), value);
                        for (p, v) in drawn {
                            assert!(!(v == variant && p.id != a), "{variant} wypadł w kasynie karcie {}", p.id);
                        }
                    }
                }
                // kontrakt i ulepszacz: base_variants (bez wariantów z listą kart) + house_extra tej karty
                assert!(!gd.card_variants(&b).iter().any(|v| v == variant) && gd.card_variants(&a).iter().any(|v| v == variant));
                assert!(!cat.house_extra_in(&gd, cat.person(&b).unwrap()).iter().any(|v| v == variant), "{variant}: house_extra({b})");
                assert_eq!(cat.house_extra_in(&gd, cat.person(&a).unwrap()).iter().any(|v| v == variant), !crate_only, "{variant}: house_extra({a})");
            }
        }
        crate::catalog::build(&[], &[]);   // przywraca domyślne dane gry
    }
}
