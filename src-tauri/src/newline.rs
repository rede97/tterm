// Output newline processing (device -> terminal) for serial sessions.
// See docs/serial-newlines.md for the option semantics.
//
// The filter is a 1-byte state machine: a CR at the end of a chunk is held
// (`pending_cr`) until the next byte decides whether it formed a CRLF pair.
// This makes pair-aware modes correct across arbitrary chunk boundaries.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NewlineMode {
    Keep,      // pass through unchanged (default)
    CrInLf,    // implicit CR in every LF: lone LF -> CRLF (pairs untouched)
    LfInCr,    // implicit LF in every CR: every CR gains an LF
    ForceCrlf, // all endings -> CRLF
    ForceLf,   // all endings -> LF
    ForceCr,   // all endings -> CR
    Strip,     // remove CR and LF entirely
}

impl NewlineMode {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "keep" => Ok(Self::Keep),
            "cr-in-lf" => Ok(Self::CrInLf),
            "lf-in-cr" => Ok(Self::LfInCr),
            "force-crlf" => Ok(Self::ForceCrlf),
            "force-lf" => Ok(Self::ForceLf),
            "force-cr" => Ok(Self::ForceCr),
            "strip" => Ok(Self::Strip),
            _ => Err(format!(
                "Invalid newline mode: {} (keep|cr-in-lf|lf-in-cr|force-crlf|force-lf|force-cr|strip)",
                s
            )),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Keep => "keep",
            Self::CrInLf => "cr-in-lf",
            Self::LfInCr => "lf-in-cr",
            Self::ForceCrlf => "force-crlf",
            Self::ForceLf => "force-lf",
            Self::ForceCr => "force-cr",
            Self::Strip => "strip",
        }
    }
}

pub struct NewlineFilter {
    mode: NewlineMode,
    pending_cr: bool,
}

impl NewlineFilter {
    pub fn new(mode: NewlineMode) -> Self {
        Self { mode, pending_cr: false }
    }

    pub fn set_mode(&mut self, mode: NewlineMode) {
        self.mode = mode;
        self.pending_cr = false;
    }

    // Transform `input`, appending to `out` (out is NOT cleared first).
    pub fn process(&mut self, input: &[u8], out: &mut Vec<u8>) {
        for &b in input {
            if self.pending_cr {
                self.pending_cr = false;
                if b == b'\n' {
                    self.emit_pair(out);
                    continue;
                }
                self.emit_lone_cr(out);
            }
            match b {
                b'\r' => self.pending_cr = true,
                b'\n' => self.emit_lone_lf(out),
                _ => out.push(b),
            }
        }
    }

    fn emit_lone_cr(&self, out: &mut Vec<u8>) {
        match self.mode {
            NewlineMode::Keep | NewlineMode::CrInLf | NewlineMode::ForceCr => out.push(b'\r'),
            NewlineMode::LfInCr | NewlineMode::ForceCrlf => out.extend_from_slice(b"\r\n"),
            NewlineMode::ForceLf => out.push(b'\n'),
            NewlineMode::Strip => {}
        }
    }

    fn emit_lone_lf(&self, out: &mut Vec<u8>) {
        match self.mode {
            NewlineMode::Keep | NewlineMode::LfInCr | NewlineMode::ForceLf => out.push(b'\n'),
            NewlineMode::CrInLf | NewlineMode::ForceCrlf => out.extend_from_slice(b"\r\n"),
            NewlineMode::ForceCr => out.push(b'\r'),
            NewlineMode::Strip => {}
        }
    }

    fn emit_pair(&self, out: &mut Vec<u8>) {
        match self.mode {
            // pair is already a valid CRLF; CrInLf needs no extra CR
            NewlineMode::Keep | NewlineMode::CrInLf | NewlineMode::ForceCrlf => {
                out.extend_from_slice(b"\r\n")
            }
            // implicit LF for the CR, plus the pair's own LF
            NewlineMode::LfInCr => out.extend_from_slice(b"\r\n\n"),
            NewlineMode::ForceLf => out.push(b'\n'),
            NewlineMode::ForceCr => out.push(b'\r'),
            NewlineMode::Strip => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(mode: NewlineMode, chunks: &[&[u8]]) -> Vec<u8> {
        let mut f = NewlineFilter::new(mode);
        let mut out = Vec::new();
        for c in chunks {
            f.process(c, &mut out);
        }
        // stream end: flush a held CR as if EOF (serial streams don't end,
        // but tests should see deterministic output)
        if f.pending_cr {
            f.pending_cr = false;
            f.emit_lone_cr(&mut out);
        }
        out
    }

    #[test]
    fn mode_roundtrip() {
        for s in ["keep", "cr-in-lf", "lf-in-cr", "force-crlf", "force-lf", "force-cr", "strip"] {
            assert_eq!(NewlineMode::from_str(s).unwrap().as_str(), s);
        }
        assert!(NewlineMode::from_str("bogus").is_err());
    }

    #[test]
    fn keep_passes_through() {
        assert_eq!(run(NewlineMode::Keep, &[b"a\rb\r\nc\n"]), b"a\rb\r\nc\n".to_vec());
    }

    #[test]
    fn cr_in_lf_fixes_lone_lf() {
        assert_eq!(run(NewlineMode::CrInLf, &[b"a\nb"]), b"a\r\nb".to_vec());
        // pairs stay pairs (no duplicated CR)
        assert_eq!(run(NewlineMode::CrInLf, &[b"a\r\nb"]), b"a\r\nb".to_vec());
        // lone CR untouched
        assert_eq!(run(NewlineMode::CrInLf, &[b"a\rb"]), b"a\rb".to_vec());
    }

    #[test]
    fn lf_in_cr_adds_lf_after_every_cr() {
        assert_eq!(run(NewlineMode::LfInCr, &[b"a\rb"]), b"a\r\nb".to_vec());
        // PuTTY semantics: pair's CR gains an LF, then its own LF follows
        assert_eq!(run(NewlineMode::LfInCr, &[b"a\r\nb"]), b"a\r\n\nb".to_vec());
    }

    #[test]
    fn force_crlf_normalizes_everything() {
        assert_eq!(run(NewlineMode::ForceCrlf, &[b"a\rb\nc\r\nd"]), b"a\r\nb\r\nc\r\nd".to_vec());
    }

    #[test]
    fn force_lf_collapses_pairs() {
        assert_eq!(run(NewlineMode::ForceLf, &[b"a\r\nb\rc\n"]), b"a\nb\nc\n".to_vec());
    }

    #[test]
    fn force_cr_collapses_to_cr() {
        assert_eq!(run(NewlineMode::ForceCr, &[b"a\r\nb\nc\n"]), b"a\rb\rc\r".to_vec());
    }

    #[test]
    fn strip_removes_endings() {
        assert_eq!(run(NewlineMode::Strip, &[b"a\r\nb\nc\r"]), b"abc".to_vec());
    }

    #[test]
    fn crlf_split_across_chunks() {
        // CR at end of chunk 1, LF at start of chunk 2 -> recognized as pair
        assert_eq!(run(NewlineMode::ForceLf, &[b"a\r", b"\nb"]), b"a\nb".to_vec());
        assert_eq!(run(NewlineMode::CrInLf, &[b"a\r", b"\nb"]), b"a\r\nb".to_vec());
        // held CR followed by non-LF -> lone CR handling
        assert_eq!(run(NewlineMode::ForceCrlf, &[b"a\r", b"bc"]), b"a\r\nbc".to_vec());
    }

    #[test]
    fn binary_bytes_untouched() {
        let data: Vec<u8> = (0u8..=255).filter(|&b| b != b'\r' && b != b'\n').collect();
        assert_eq!(run(NewlineMode::ForceCrlf, &[&data]), data);
    }

    #[test]
    fn set_mode_resets_pending_state() {
        let mut f = NewlineFilter::new(NewlineMode::ForceLf);
        let mut out = Vec::new();
        f.process(b"a\r", &mut out); // CR held
        f.set_mode(NewlineMode::Keep);
        f.process(b"\n", &mut out); // not a pair anymore -> lone LF under Keep
        assert_eq!(out, b"a\n".to_vec());
    }
}
