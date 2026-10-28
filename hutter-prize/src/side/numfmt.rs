//! From a distribution over numbers to a distribution over the next character
//! of how the number is spelled.

use super::ByteDist;

/// Discrete Laplace mass of the integers in `lo..=hi`, centred on `mu`.
pub fn laplace_mass(lo: f64, hi: f64, mu: f64, b: f64) -> f64 {
    let (a, z) = (lo - 0.5, hi + 0.5);
    if a >= mu {
        0.5 * ((-(a - mu) / b).exp() - (-(z - mu) / b).exp())
    } else if z <= mu {
        0.5 * (((z - mu) / b).exp() - ((a - mu) / b).exp())
    } else {
        1.0 - 0.5 * (-(z - mu) / b).exp() - 0.5 * ((a - mu) / b).exp()
    }
}

/// Unnormalised masses of the next character of a plain decimal spelling
/// (no sign, no leading zeros) of a value in `lo..=hi`, given the digits typed
/// so far: indices 0..=9 are the digits, 10 is the terminator.
pub fn decimal_next(typed: &[u8], lo: i64, hi: i64, mass: &impl Fn(i64, i64) -> f64) -> [f64; 11] {
    let mut out = [0.0f64; 11];
    let ext = |q: i64| -> f64 {
        // Values whose spelling starts with q: q, q0..q9, q00..q99, ...
        let (mut a, mut b) = (q, q);
        let mut tot = 0.0;
        while a <= hi {
            let (l, h) = (a.max(lo), b.min(hi));
            if l <= h {
                tot += mass(l, h);
            }
            if a > i64::MAX / 10 - 10 {
                break;
            }
            a *= 10;
            b = b * 10 + 9;
        }
        tot
    };
    if typed.is_empty() {
        if lo <= 0 && 0 <= hi {
            out[0] = mass(0, 0);
        }
        for d in 1..=9 {
            out[d as usize] = ext(d);
        }
        return out;
    }
    if typed[0] == b'0' || typed.len() > 17 || !typed.iter().all(u8::is_ascii_digit) {
        // "0" can only be followed by the terminator; anything else is off-model.
        if typed == b"0" && lo <= 0 && 0 <= hi {
            out[10] = mass(0, 0);
        }
        return out;
    }
    let p: i64 = typed.iter().fold(0i64, |v, &c| v * 10 + (c - b'0') as i64);
    if lo <= p && p <= hi {
        out[10] = mass(p, p);
    }
    for d in 0..=9 {
        out[d as usize] = ext(p * 10 + d);
    }
    out
}

/// Fills `dist` from digit/terminator masses. Returns false if the masses are
/// all zero (the typed prefix is outside the model).
pub fn to_dist(m: &[f64; 11], term: u8, escape: f32, dist: &mut ByteDist) -> bool {
    dist.clear();
    let tot: f64 = m.iter().sum();
    if tot.is_nan() || tot <= 0.0 || !tot.is_finite() {
        return false;
    }
    for (i, &v) in m.iter().enumerate() {
        if v > 0.0 {
            let b = if i == 10 { term } else { b'0' + i as u8 };
            dist.cand.push((b, (v / tot) as f32));
        }
    }
    dist.normalise(escape);
    true
}

/// Next-character distribution over a set of candidate spellings, given what
/// was typed so far. Candidates that no longer match are ignored; a candidate
/// typed in full predicts `term`.
pub fn candidates_next(
    cands: &[(Vec<u8>, f32)],
    typed: &[u8],
    term: u8,
    escape: f32,
    dist: &mut ByteDist,
) -> bool {
    dist.clear();
    for (s, p) in cands {
        if s.len() >= typed.len() && &s[..typed.len()] == typed {
            let b = if s.len() > typed.len() {
                s[typed.len()]
            } else {
                term
            };
            match dist.cand.iter_mut().find(|c| c.0 == b) {
                Some(c) => c.1 += *p,
                None => dist.cand.push((b, *p)),
            }
        }
    }
    if dist.cand.is_empty() {
        return false;
    }
    dist.normalise(escape);
    true
}

/// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's algorithm).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

pub fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        _ => 28,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimal_masses_sum_to_total() {
        // Uniform mass over 0..=999: first-digit masses must add up to 1000.
        let m = |a: i64, b: i64| (b - a + 1) as f64;
        let out = decimal_next(b"", 0, 999, &m);
        assert_eq!(out.iter().sum::<f64>(), 1000.0);
        assert_eq!(out[1], 111.0); // 1, 10..19, 100..199
        let out = decimal_next(b"4", 0, 999, &m);
        assert_eq!(out[10], 1.0); // "4" itself
        assert_eq!(out[2], 11.0); // 42, 420..429
    }

    #[test]
    fn laplace_mass_is_a_distribution() {
        let tot = laplace_mass(-10_000.0, 10_000.0, 3.3, 2.0);
        assert!((tot - 1.0).abs() < 1e-9);
        let split = laplace_mass(-10_000.0, 3.0, 3.3, 2.0) + laplace_mass(4.0, 10_000.0, 3.3, 2.0);
        assert!((split - 1.0).abs() < 1e-9);
    }

    #[test]
    fn civil_dates() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2006, 3, 4) * 86400, 1_141_430_400);
    }
}
