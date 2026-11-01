//! Szachy: zasady i bot. Ruchy liczy cozy-chess (roszady, bicie w przelocie, promocje, mat, pat, 50 ruchów); tu są
//! remisy, których biblioteka nie zna (trzykrotne powtórzenie, brak materiału), zapis partii i bot. Partia to lista
//! ruchów w UCI - pozycję odtwarzamy z niej przy każdym zapytaniu.

use std::collections::HashMap;

use cozy_chess::util::{display_san_move, display_uci_move, parse_uci_move};
use cozy_chess::{Board, Color, GameStatus, Move, Piece, Square};
use rand::seq::SliceRandom;
use rand::Rng;

/// Pozycja po ruchach z zapisu + zapis SAN i liczniki powtórzeń
pub struct Position {
    pub board: Board,
    pub san: Vec<String>,
    repeats: HashMap<u64, u8>,
}

/// Koniec partii wynikający z samej pozycji
#[derive(Debug, PartialEq, Eq)]
pub enum Finish {
    Mate(Color),
    Draw(&'static str),
}

impl Position {
    pub fn new() -> Self {
        let board = Board::default();
        let repeats = HashMap::from([(board.hash_without_ep(), 1)]);
        Position { board, san: vec![], repeats }
    }

    /// Ruch w UCI (e2e4, e7e8q); None = nielegalny
    pub fn play(&mut self, uci: &str) -> Option<()> {
        let mv = parse_uci_move(&self.board, uci).ok()?;
        self.board.is_legal(mv).then_some(())?;
        self.san.push(display_san_move(&self.board, mv).to_string());
        self.board.play_unchecked(mv);
        *self.repeats.entry(self.board.hash_without_ep()).or_insert(0) += 1;
        Some(())
    }

    /// Odtworzenie partii z zapisu; None = zapis nie pasuje do zasad
    pub fn replay<'a>(moves: impl IntoIterator<Item = &'a str>) -> Option<Self> {
        let mut pos = Position::new();
        for m in moves {
            pos.play(m)?;
        }
        Some(pos)
    }

    pub fn finish(&self) -> Option<Finish> {
        match self.board.status() {
            GameStatus::Won => Some(Finish::Mate(!self.board.side_to_move())),
            GameStatus::Drawn if legal_moves(&self.board).is_empty() => Some(Finish::Draw("pat")),
            GameStatus::Drawn => Some(Finish::Draw("zasada 50 ruchów")),
            GameStatus::Ongoing if !enough_material(&self.board) => Some(Finish::Draw("brak materiału")),
            GameStatus::Ongoing if self.repeats.values().any(|n| *n >= 3) => Some(Finish::Draw("trzykrotne powtórzenie")),
            GameStatus::Ongoing => None,
        }
    }
}

pub fn legal_moves(board: &Board) -> Vec<Move> {
    let mut out = vec![];
    board.generate_moves(|m| {
        out.extend(m);
        false
    });
    out
}

/// Legalne ruchy w UCI (dla przeglądarki)
pub fn legal_uci(board: &Board) -> Vec<String> {
    legal_moves(board).into_iter().map(|m| display_uci_move(board, m).to_string()).collect()
}

fn light_square(s: Square) -> bool {
    (s.file() as usize + s.rank() as usize) % 2 == 1
}

/// Czy ktokolwiek może jeszcze dać mata. Sam król, król + jedna lekka figura albo gońce tylko na polach jednego koloru = remis.
pub fn enough_material(b: &Board) -> bool {
    if !(b.pieces(Piece::Pawn) | b.pieces(Piece::Rook) | b.pieces(Piece::Queen)).is_empty() {
        return true;
    }
    let (knights, bishops) = (b.pieces(Piece::Knight).len(), b.pieces(Piece::Bishop));
    if knights + bishops.len() <= 1 {
        return false;
    }
    if knights > 0 {
        return true;
    }
    bishops.into_iter().any(light_square) && bishops.into_iter().any(|s| !light_square(s))
}

/// Czy dana strona sama mogłaby dać mata - przy czasie: bez tego przekroczenie czasu daje remis
pub fn can_mate(b: &Board, side: Color) -> bool {
    let c = b.colors(side);
    let heavy = (b.pieces(Piece::Pawn) | b.pieces(Piece::Rook) | b.pieces(Piece::Queen)) & c;
    !heavy.is_empty() || ((b.pieces(Piece::Knight) | b.pieces(Piece::Bishop)) & c).len() >= 2
}

// ---------------------------------------------------------------- bot

const MATE: i32 = 100_000;
const NODES: u32 = 300_000;

fn value(p: Piece) -> i32 {
    match p {
        Piece::Pawn => 100,
        Piece::Knight => 320,
        Piece::Bishop => 335,
        Piece::Rook => 500,
        Piece::Queen => 900,
        Piece::King => 0,
    }
}

/// Premia za pole: figury do środka, pionki naprzód; król chowa się, dopóki na planszy jest dużo figur
fn square_bonus(p: Piece, s: Square, side: Color, endgame: bool) -> i32 {
    let (f, r) = (s.file() as i32, s.rank() as i32);
    let rank = if side == Color::White { r } else { 7 - r };
    let centre = 6 - ((2 * f - 7).abs() + (2 * rank - 7).abs()) / 2;
    match p {
        Piece::Pawn => rank * 6 + if (3..=4).contains(&f) { rank * 3 } else { 0 },
        Piece::Knight => centre * 6,
        Piece::Bishop => centre * 4,
        Piece::Rook => i32::from(rank == 6) * 20,
        Piece::Queen => centre,
        Piece::King if endgame => centre * 5,
        Piece::King => -centre * 6 - rank * 10,
    }
}

fn eval(b: &Board) -> i32 {
    let endgame = (b.pieces(Piece::Queen).is_empty() && b.occupied().len() < 16) || b.occupied().len() < 10;
    let mut score = 0;
    for s in b.occupied() {
        let (Some(p), Some(c)) = (b.piece_on(s), b.color_on(s)) else { continue };
        let v = value(p) + square_bonus(p, s, c, endgame);
        score += if c == b.side_to_move() { v } else { -v };
    }
    score
}

fn ordered(b: &Board) -> Vec<Move> {
    let mut list = legal_moves(b);
    let score = |m: &Move| b.piece_on(m.to).map_or(0, |v| 10 * value(v) - b.piece_on(m.from).map_or(0, value)) + m.promotion.map_or(0, value);
    list.sort_by_key(|m| -score(m));
    list
}

/// Spokojna pozycja: po głębokości 0 kończymy wymiany, żeby bot nie brał figury, którą zaraz straci
fn quiet(b: &Board, mut a: i32, c: i32, nodes: &mut u32, depth: u32) -> i32 {
    *nodes += 1;
    let stand = eval(b);
    if stand >= c || depth == 0 {
        return stand;
    }
    a = a.max(stand);
    for m in ordered(b).into_iter().filter(|m| b.color_on(m.to).is_some()) {
        let mut n = b.clone();
        n.play_unchecked(m);
        let s = -quiet(&n, -c, -a, nodes, depth - 1);
        if s >= c {
            return s;
        }
        a = a.max(s);
    }
    a
}

fn search(b: &Board, depth: u32, ply: i32, mut a: i32, c: i32, nodes: &mut u32) -> i32 {
    let list = ordered(b);
    if list.is_empty() {
        return if b.checkers().is_empty() { 0 } else { ply - MATE };
    }
    if b.halfmove_clock() >= 100 {
        return 0;
    }
    if depth == 0 || *nodes > NODES {
        return quiet(b, a, c, nodes, 4);
    }
    for m in list {
        *nodes += 1;
        let mut n = b.clone();
        n.play_unchecked(m);
        let s = -search(&n, depth - 1, ply + 1, -c, -a, nodes);
        if s >= c {
            return s;
        }
        a = a.max(s);
    }
    a
}

/// Ruch bota w UCI. Poziom 1-3: głębokość liczenia i szum w ocenie (niższy poziom popełnia błędy).
pub fn bot_move(board: &Board, level: i32) -> Option<String> {
    let (depth, noise) = match level {
        1 => (1, 140),
        2 => (2, 45),
        _ => (3, 6),
    };
    let mut rng = rand::thread_rng();
    let mut list = legal_moves(board);
    list.shuffle(&mut rng);
    let mut nodes = 0;
    let best = list.into_iter().max_by_key(|m| {
        let mut n = board.clone();
        n.play_unchecked(*m);
        -search(&n, depth, 1, -MATE - 1, MATE + 1, &mut nodes) + rng.gen_range(-noise..=noise)
    })?;
    Some(display_uci_move(board, best).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(moves: &str) -> Position {
        Position::replay(moves.split_whitespace()).expect("legalne ruchy")
    }

    #[test]
    fn mat_szewczyka_i_glupi() {
        assert_eq!(game("f2f3 e7e5 g2g4 d8h4").finish(), Some(Finish::Mate(Color::Black)));
        assert_eq!(game("e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7").finish(), Some(Finish::Mate(Color::White)));
        assert_eq!(game("e2e4 e7e5").finish(), None);
    }

    #[test]
    fn nielegalne_ruchy() {
        assert!(Position::replay(["e2e5"]).is_none());
        assert!(Position::replay(["e7e5"]).is_none());
        // związany pion nie może odsłonić króla
        let pinned: Board = "4k3/8/8/8/7b/8/5P2/4K3 w - - 0 1".parse().unwrap();
        assert!(!legal_uci(&pinned).contains(&"f2f3".to_owned()));
    }

    #[test]
    fn roszada_przelot_promocja() {
        let p = game("e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 e1g1");
        assert_eq!(p.san.last().unwrap(), "O-O");
        assert_eq!(p.board.piece_on(Square::G1), Some(Piece::King));
        assert_eq!(p.board.piece_on(Square::F1), Some(Piece::Rook));
        let p = game("e2e4 a7a6 e4e5 d7d5 e5d6");
        assert_eq!(p.board.piece_on(Square::D5), None);
        assert_eq!(p.san.last().unwrap(), "exd6");
        let p = game("a2a4 b7b5 a4b5 a7a6 b5a6 c8b7 a6b7 h7h6 b7a8q");
        assert_eq!(p.board.piece_on(Square::A8), Some(Piece::Queen));
        assert!(legal_uci(&game("a2a4 b7b5 a4b5 a7a6 b5a6 c8b7 a6b7 h7h6").board).contains(&"b7a8n".to_owned()));
    }

    #[test]
    fn remisy() {
        // trzykrotne powtórzenie
        let p = game("g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8");
        assert_eq!(p.finish(), Some(Finish::Draw("trzykrotne powtórzenie")));
        // pat (najkrótszy znany - Sam Loyd)
        let p = game("e2e3 a7a5 d1h5 a8a6 h5a5 h7h5 h2h4 a6h6 a5c7 f7f6 c7d7 e8f7 d7b7 d8d3 b7b8 d3h7 b8c8 f7g6 c8e6");
        assert_eq!(p.finish(), Some(Finish::Draw("pat")));
        // brak materiału
        for (fen, enough) in [("8/8/4k3/8/8/4K3/8/8 w - - 0 1", false), ("8/8/4k3/8/8/4KN2/8/8 w - - 0 1", false),
            ("8/8/4kb2/8/8/4KB2/8/8 w - - 0 1", true), ("8/8/4k3/8/8/4K3/4P3/8 w - - 0 1", true), ("8/8/4kb2/8/3B4/4K3/8/8 w - - 0 1", false)] {
            assert_eq!(enough_material(&fen.parse().unwrap()), enough, "{fen}");
        }
    }

    #[test]
    fn bot_gra_legalnie_i_bierze_mata() {
        let p = game("e2e4 e7e5 f1c4 b8c6 d1h5 g8f6");
        // trzeci poziom dostrzega mata w jednym
        assert_eq!(bot_move(&game("e2e4 e7e5 f1c4 b8c6 d1h5 a7a6").board, 3).as_deref(), Some("h5f7"));
        for level in 1..=3 {
            let mv = bot_move(&p.board, level).unwrap();
            assert!(legal_uci(&p.board).contains(&mv));
        }
        // cała partia sama ze sobą kończy się albo zostaje w zasadach
        let mut pos = Position::new();
        for _ in 0..60 {
            if pos.finish().is_some() {
                break;
            }
            let mv = bot_move(&pos.board, 1).unwrap();
            pos.play(&mv).unwrap();
        }
    }

    #[test]
    fn czas_a_material() {
        let b: Board = "8/8/4k3/8/8/4KN2/8/8 w - - 0 1".parse().unwrap();
        assert!(!can_mate(&b, Color::White));
        let b: Board = "8/8/4k3/8/8/4KR2/8/8 w - - 0 1".parse().unwrap();
        assert!(can_mate(&b, Color::White) && !can_mate(&b, Color::Black));
    }
}
