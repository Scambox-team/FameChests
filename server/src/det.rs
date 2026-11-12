//! Wspólna matematyka deterministyczna dla serwerowych odtworzeń gier (snake_sim, snake3d_sim, run_sim): te same wyniki co w
//! przeglądarce bit w bit. Z f64 używamy tylko + - * / sqrt floor abs min max i własnych sin / cos z szeregu (libm i silniki JS
//! potrafią różnić się w ostatnim bicie - dlatego rdzenie gier liczą bez nich albo własnym szeregiem, jak run_sim).

/// mulberry32 (jak `Rng` w rdzeniach TS): 32-bitowy generator z ziarnem
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(seed)
    }
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6D2B79F5);
        let a = self.0;
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        f64::from(t ^ (t >> 14)) / 4294967296.0
    }
}

/// `Math.round` z JS dla zwykłych liczb (połówki w górę, także ujemne)
pub fn jround(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// `((a % n) + n) % n` z JS
pub fn fmod(a: f64, n: f64) -> f64 {
    ((a % n) + n) % n
}
