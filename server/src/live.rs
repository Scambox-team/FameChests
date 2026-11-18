//! Gry z wynikiem liczonym przez serwer: losowość wydawana na raty („commit-reveal”).
//!
//! Dawniej serwer dawał przy starcie jedno ziarno na całą grę. Skoro rdzeń gry jest deterministyczny, skrypt znał z niego
//! CAŁĄ przyszłość (wszystkie jabłka, tunel, cele) i mógł policzyć idealną grę bez grania, odczekać minimalny czas i wysłać
//! jeden spreparowany zapis. Teraz gra jest podzielona na odcinki po `seg` kroków, a każdy odcinek losuje z WŁASNEGO ziarna
//! (`det::Rng` od nowa na początku odcinka). Przy starcie przeglądarka dostaje ziarna odcinków 0..=`ahead`; kolejne serwer
//! wydaje dopiero po `commit`: przeglądarka wysyła zapis klawiszy do początku odcinka `k` (zapis jest od tej chwili
//! NIEZMIENNY - koniec gry dokleja tylko dalsze zdarzenia), a serwer sprawdza, że od startu minęło tyle prawdziwego czasu,
//! ile trwa `k` odcinków. Kto chce znać przyszłość, musi grać na żywo i z góry zobowiązać się do swoich ruchów - nie da się
//! już policzyć gry offline, a odtworzenie, które sięgnęłoby po niewydane ziarno, jest odrzucane.

use std::time::Instant;

use sha2::{Digest, Sha256};

/// Ile odcinków do przodu zna przeglądarka (zapas na opóźnienia sieci)
pub const AHEAD: u64 = 3;

pub struct Live {
    master: [u8; 32],
    pub at: Instant,
    /// kroków gry w odcinku
    pub seg: u64,
    /// najkrótszy możliwy czas jednego kroku w sekundach
    min_tick: f64,
    /// ile liczb ma jedno zdarzenie zapisu (pierwsza = numer kroku)
    stride: usize,
    /// zatwierdzony zapis
    log: Vec<i64>,
    /// odcinki 0..committed mają niezmienny zapis
    committed: u64,
}

impl Live {
    pub fn new(seg: u64, min_tick: f64, stride: usize) -> Live {
        Live { master: rand::random(), at: Instant::now(), seg: seg.max(1), min_tick, stride: stride.max(2), log: Vec::new(), committed: 0 }
    }

    /// Ziarno odcinka `k` (sha256 tajnego klucza biletu i numeru)
    pub fn seed(&self, k: u64) -> u32 {
        let mut h = Sha256::new();
        h.update(self.master);
        h.update(k.to_le_bytes());
        let d = h.finalize();
        u32::from_le_bytes([d[0], d[1], d[2], d[3]])
    }

    /// Ziarna już wydane przeglądarce: odcinki 0..=committed+AHEAD
    pub fn released(&self) -> Vec<u32> {
        (0..=self.committed + AHEAD).map(|k| self.seed(k)).collect()
    }

    /// Sprawdza kawałek zapisu: pełne zdarzenia, numery kroków nie maleją i nie są wcześniejsze niż `from`
    fn valid_delta(&self, delta: &[i64], from: u64) -> bool {
        if !delta.len().is_multiple_of(self.stride) {
            return false;
        }
        let mut last = self.log.len().checked_sub(self.stride).map_or(from as i64, |i| self.log[i]).max(from as i64);
        for ev in delta.chunks(self.stride) {
            if ev[0] < last {
                return false;
            }
            last = ev[0];
        }
        true
    }

    /// Zatwierdza zapis do początku odcinka `upto` (zdarzenia z krokami < upto * seg) i wydaje kolejne ziarna.
    /// Err = zapis albo tempo nie do przyjęcia (bilet trzeba wtedy porzucić).
    pub fn commit(&mut self, upto: u64, delta: &[i64]) -> Result<Vec<u32>, &'static str> {
        if upto <= self.committed {
            return if delta.is_empty() { Ok(self.released()) } else { Err("zapis już zatwierdzony") };
        }
        // żeby dojść do początku odcinka `upto`, trzeba było znać ziarna odcinków < upto
        if upto > self.committed + AHEAD + 1 {
            return Err("odcinek bez ziarna");
        }
        if !self.valid_delta(delta, self.committed * self.seg) || delta.chunks(self.stride).any(|ev| ev[0] >= (upto * self.seg) as i64) {
            return Err("zły zapis");
        }
        // gra nie mogła dojść tak daleko szybciej niż w prawdziwym czasie (tolerancja 10% + 3 s)
        if self.at.elapsed().as_secs_f64() + 3.0 < (upto * self.seg) as f64 * self.min_tick * 0.9 {
            return Err("za szybko");
        }
        self.log.extend_from_slice(delta);
        self.committed = upto;
        Ok(self.released())
    }

    /// Koniec gry: zatwierdzony zapis + reszta zdarzeń (nie wcześniej niż zatwierdzony odcinek) i wydane ziarna
    pub fn finish(mut self, delta: &[i64]) -> Option<(Vec<i64>, Vec<u32>)> {
        if !self.valid_delta(delta, self.committed * self.seg) {
            return None;
        }
        self.log.extend_from_slice(delta);
        let seeds = self.released();
        Some((self.log, seeds))
    }
}

#[cfg(test)]
/// Ziarna odcinków do testów i nagrań botów (to samo co `segSeed` w web/scripts/*-fixture.mjs)
pub fn test_seeds(base: u32, n: u64) -> Vec<u32> {
    (0..n).map(|k| (crate::det::Rng::new(base ^ (k as u32).wrapping_mul(0x9E37_79B9)).next() * 4294967296.0) as u32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_come_in_installments() {
        let mut l = Live::new(10, 0.0, 2);
        assert_eq!(l.released().len() as u64, AHEAD + 1);
        // odcinek dalej niż znane ziarna
        assert!(l.commit(AHEAD + 2, &[]).is_err());
        assert_eq!(l.commit(1, &[0, 1, 5, 2]).unwrap().len() as u64, AHEAD + 2);
        // zdarzenie z zatwierdzonego odcinka albo za granicą odcinka
        assert!(l.commit(2, &[3, 1]).is_err());
        assert!(l.commit(2, &[20, 1]).is_err());
        assert!(l.commit(2, &[12, 1]).is_ok());
        let first = l.seed(0);
        let (log, seeds) = l.finish(&[25, 3]).unwrap();
        assert_eq!(log, vec![0, 1, 5, 2, 12, 1, 25, 3]);
        assert_eq!(seeds[0], first);
        assert_eq!(seeds.len() as u64, 2 + AHEAD + 1);
    }

    #[test]
    fn too_fast_is_rejected() {
        let mut l = Live::new(1000, 1.0, 2);
        assert_eq!(l.commit(1, &[]), Err("za szybko"));
    }

    #[test]
    fn finish_cannot_rewrite_committed_part() {
        let mut l = Live::new(10, 0.0, 2);
        l.commit(1, &[2, 1]).unwrap();
        assert!(l.finish(&[4, 0]).is_none());
    }
}
