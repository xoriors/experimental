//! enwik9 pages, the record holder's article order, and its PHDA9 stream split.
//!
//! The record holder (fx2-cmix-T, July 2026) and its ancestors do not
//! compress enwik9 in file order. They (1) reorder the articles by topic and
//! move every redirect to the end, then (2) apply the PHDA9 transform, which
//! pulls each page's header (ids, timestamp, contributor) and its trailing
//! interwiki links out of the article text into two streams appended after
//! the text. This module rebuilds that layout from enwik9 so that every
//! experiment sees the bytes the record holder's models see (before its
//! word-dictionary transform, which does not touch the fields studied here).
//! It is a reimplementation from reading their source, not a byte-exact copy.

use std::ops::Range;

/// One `<page>` element, located by line.
#[derive(Clone, Debug)]
pub struct Page {
    /// Byte range of the page, from "  <page>" to the end of "  </page>\n".
    pub span: Range<usize>,
    pub title: Range<usize>,
    pub id: u64,
    /// Lines of the page: byte ranges, each including its '\n'.
    pub lines: Vec<Range<usize>>,
    /// Index of the "<text" line within `lines`.
    pub text_line: usize,
    /// Index of the line that closes the header (the "</contributor>" line
    /// or the self-closing "<contributor deleted" one).
    pub header_end: usize,
    pub redirect: bool,
}

/// Splits enwik9 into complete pages. The trailing, truncated page is not
/// returned (the record holder keeps it verbatim in its "coda").
pub fn pages(data: &[u8]) -> Vec<Page> {
    let mut out = Vec::with_capacity(250_000);
    let mut pos = 0usize;
    let mut cur: Option<Vec<Range<usize>>> = None;
    let mut start = 0usize;
    while pos < data.len() {
        let end = match memchr(b'\n', &data[pos..]) {
            Some(i) => pos + i + 1,
            None => data.len(),
        };
        let line = &data[pos..end];
        if line == b"  <page>\n" {
            cur = Some(Vec::with_capacity(16));
            start = pos;
        }
        if let Some(lines) = cur.as_mut() {
            lines.push(pos..end);
            if line == b"  </page>\n" {
                let lines = cur.take().unwrap();
                if let Some(p) = make_page(data, start..end, lines) {
                    out.push(p);
                }
            }
        }
        pos = end;
    }
    out
}

fn make_page(data: &[u8], span: Range<usize>, lines: Vec<Range<usize>>) -> Option<Page> {
    let title_line = &data[lines.get(1)?.clone()];
    let t0 = lines[1].start + find(title_line, b"<title>")? + 7;
    let t1 = lines[1].start + find(title_line, b"</title>")?;
    let id_line = &data[lines.get(2)?.clone()];
    let id = parse_tag_u64(id_line, b"<id>")?;
    let text_line = lines
        .iter()
        .position(|r| data[r.clone()].starts_with(b"      <text"))?;
    let header_end = lines
        .iter()
        .position(|r| {
            let l = &data[r.clone()];
            l.starts_with(b"      </contributor>") || l.starts_with(b"      <contributor deleted")
        })
        .unwrap_or(text_line.saturating_sub(1));
    let tl = &data[lines[text_line].clone()];
    const REDIRECT: [&[u8]; 5] = [
        b"      <text xml:space=\"preserve\">#REDIRECT",
        b"      <text xml:space=\"preserve\">#redirect",
        b"      <text xml:space=\"preserve\">#Redirect",
        b"      <text xml:space=\"preserve\">#REdirect",
        b"      <text xml:space=\"preserve\">{{softredirect",
    ];
    let redirect = REDIRECT.iter().any(|p| tl.starts_with(p));
    Some(Page {
        span,
        title: t0..t1,
        id,
        lines,
        text_line,
        header_end,
        redirect,
    })
}

/// Processing order: the record holder's article order (indices among
/// non-redirect pages, one per line) followed by every remaining page in file
/// order. Without an order file, file order.
pub fn order(pages: &[Page], order_file: Option<&[u8]>) -> Vec<usize> {
    let Some(text) = order_file else {
        return (0..pages.len()).collect();
    };
    let non_redirect: Vec<usize> = (0..pages.len()).filter(|&i| !pages[i].redirect).collect();
    let mut used = vec![false; pages.len()];
    let mut out = Vec::with_capacity(pages.len());
    for line in text.split(|&c| c == b'\n') {
        let Ok(k) = std::str::from_utf8(line)
            .unwrap_or("")
            .trim()
            .parse::<usize>()
        else {
            continue;
        };
        if let Some(&p) = non_redirect.get(k)
            && !used[p]
        {
            used[p] = true;
            out.push(p);
        }
    }
    out.extend((0..pages.len()).filter(|&i| !used[i]));
    out
}

/// The three streams the PHDA9 transform produces, in processing order.
#[derive(Default)]
pub struct Streams {
    /// Article text and the page lines the transform leaves in place.
    pub main: Vec<u8>,
    /// One header block per page (see [`crate::side::header`]).
    pub header: Vec<u8>,
    /// Trailing interwiki lines moved out of the article text.
    pub lang: Vec<u8>,
    /// For every block in `lang`, the page index it came from.
    pub lang_pages: Vec<usize>,
}

pub fn split(data: &[u8], pages: &[Page], order: &[usize]) -> Streams {
    let mut s = Streams::default();
    let mut last_id: i64 = 0;
    for &pi in order {
        let p = &pages[pi];
        let line = |k: usize| &data[p.lines[k].clone()];
        // "  <page>" and the title stay in the main stream.
        s.main.extend_from_slice(line(0));
        s.main.extend_from_slice(line(1));
        // Header: the page id as a delta, then every line up to the end of
        // the contributor element, without indentation and closing tags.
        s.header
            .extend_from_slice(format!(">{}\n", p.id as i64 - last_id).as_bytes());
        last_id = p.id as i64;
        for k in 3..=p.header_end.min(p.lines.len() - 1) {
            phda9_header_line(line(k), &mut s.header);
        }
        // Text: find the first interwiki line (at least four lines into the
        // text); it and everything after it, up to the line holding
        // "</text>", go to the lang stream.
        let text_end = (p.text_line..p.lines.len())
            .find(|&k| find(line(k), b"</text>").is_some())
            .unwrap_or(p.lines.len() - 1);
        let lang_start = (p.text_line + 4..=text_end).find(|&k| is_lang_line(line(k)));
        for k in p.header_end + 1..p.lines.len() {
            match lang_start {
                Some(ls) if k >= ls && k <= text_end => s.lang.extend_from_slice(line(k)),
                _ => s.main.extend_from_slice(line(k)),
            }
        }
        if lang_start.is_some() {
            s.lang_pages.push(pi);
        }
    }
    s
}

/// "[[xx:...": a lowercase language code, not a category/image/media/user/http link.
fn is_lang_line(l: &[u8]) -> bool {
    if !l.starts_with(b"[[") || l.get(2) == Some(&b':') {
        return false;
    }
    let mut c = 2;
    while c < l.len() && l[c].is_ascii_lowercase() {
        c += 1;
    }
    if c == 2 || c >= l.len() || l[c] != b':' {
        return false;
    }
    let code = &l[2..c];
    !matches!(
        code,
        b"http" | b"user" | b"media" | b"image" | b"category" | b"wikt" | b"wiktionary"
    )
}

fn phda9_header_line(l: &[u8], out: &mut Vec<u8>) {
    let body = l.strip_suffix(b"\n").unwrap_or(l);
    let trimmed = &body[body.iter().position(|&c| c != b' ').unwrap_or(body.len())..];
    let trimmed = trimmed.strip_prefix(b"<").unwrap_or(trimmed);
    if let Some(ts) = trimmed.strip_prefix(b"timestamp>") {
        // 2006-03-04T01:41:25Z -> "05" + (month*31 + day - 32) + ":" + second of day
        let num = |a: usize, b: usize| -> i64 {
            std::str::from_utf8(ts.get(a..b).unwrap_or(b"0"))
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0)
        };
        let (y, mo, d, h, mi, se) = (
            num(0, 4),
            num(5, 7),
            num(8, 10),
            num(11, 13),
            num(14, 16),
            num(17, 19),
        );
        out.extend_from_slice(
            format!(
                "timestamp>{:02}{}:{}\n",
                y - 2001,
                mo * 31 + d - 32,
                h * 3600 + mi * 60 + se
            )
            .as_bytes(),
        );
        return;
    }
    // Cut at the closing tag, if the element has content on this line.
    let cut = match memchr(b'>', trimmed) {
        Some(gt) => match memchr(b'<', &trimmed[gt + 1..]) {
            Some(lt) => gt + 1 + lt,
            None => trimmed.len(),
        },
        None => trimmed.len(),
    };
    out.extend_from_slice(&trimmed[..cut]);
    out.push(b'\n');
}

pub fn title<'a>(data: &'a [u8], p: &Page) -> &'a [u8] {
    &data[p.title.clone()]
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

#[inline]
pub fn memchr(c: u8, hay: &[u8]) -> Option<usize> {
    hay.iter().position(|&b| b == c)
}

fn parse_tag_u64(line: &[u8], tag: &[u8]) -> Option<u64> {
    let i = find(line, tag)? + tag.len();
    let j = i + memchr(b'<', &line[i..])?;
    std::str::from_utf8(&line[i..j]).ok()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &[u8] = b"<mediawiki>\n  <page>\n    <title>AlgeriA</title>\n    <id>5</id>\n    <revision>\n      <id>18063769</id>\n      <timestamp>2005-07-03T11:13:13Z</timestamp>\n      <contributor>\n        <username>Docu</username>\n        <id>8029</id>\n      </contributor>\n      <minor />\n      <text xml:space=\"preserve\">#REDIRECT [[Algeria]]</text>\n    </revision>\n  </page>\n  <page>\n    <title>Anarchism</title>\n    <id>12</id>\n    <revision>\n      <id>42136831</id>\n      <timestamp>2006-03-04T01:41:25Z</timestamp>\n      <contributor>\n        <ip>1.2.3.4</ip>\n      </contributor>\n      <text xml:space=\"preserve\">a\nb\nc\nd\n[[Category:Anarchism]]\n[[de:Anarchismus]]\n[[fr:Anarchisme]]</text>\n    </revision>\n  </page>\n  <page>\n    <title>Trunc";

    #[test]
    fn splits_like_phda9() {
        let ps = pages(SAMPLE);
        assert_eq!(ps.len(), 2);
        assert!(ps[0].redirect && !ps[1].redirect);
        assert_eq!(title(SAMPLE, &ps[1]), b"Anarchism");
        let s = split(SAMPLE, &ps, &order(&ps, None));
        let h = String::from_utf8(s.header).unwrap();
        assert!(h.starts_with(">5\nrevision>\nid>18063769\ntimestamp>04188:40393\ncontributor>\nusername>Docu\nid>8029\n/contributor>\n>7\n"));
        assert!(h.contains("timestamp>0565:6085\n"));
        assert_eq!(s.lang, b"[[de:Anarchismus]]\n[[fr:Anarchisme]]</text>\n");
        assert_eq!(s.lang_pages, vec![1]);
        let m = String::from_utf8(s.main).unwrap();
        assert!(m.contains("[[Category:Anarchism]]\n    </revision>"));
        assert!(!m.contains("<timestamp>"));
    }

    #[test]
    fn order_puts_redirects_last() {
        let ps = pages(SAMPLE);
        assert_eq!(order(&ps, Some(b"0\n")), vec![1, 0]);
    }
}
