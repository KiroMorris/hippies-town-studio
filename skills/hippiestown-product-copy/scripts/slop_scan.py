#!/usr/bin/env python3
"""Vendored from the unslop skill (MyTurtle, MIT) so the Studio does not depend on ~/.claude. Only change: DTF and GSM are allowed caps.

Flag mechanical AI-writing tells in text, Markdown, or HTML.

Usage:
  python3 slop_scan.py FILE [FILE ...]
  cat draft.txt | python3 slop_scan.py
  python3 slop_scan.py email.html --json

For HTML, only visible text, image alt text, and <title> are scanned.
Hits are hints for a human or model to judge, not verdicts.
"""
import argparse
import html
import json
import re
import sys
from html.parser import HTMLParser

P1_WORDS = """delve delves delving elevate elevates elevated elevating unlock unlocks unleash unleashes
seamless seamlessly robust tapestry testament pivotal crucial vibrant curated game-changer
game-changing revolutionary groundbreaking landscape realm embark empower empowers empowering
leverage leverages foster fosters fostering showcase showcases showcasing meticulous meticulously
intricate boasts utilize utilizes facilitate facilitates navigate navigating resonate resonates
iconic timeless unparalleled world-class effortless effortlessly must-have transformative
bolster bolstered garner underscore underscores underscoring multifaceted paramount
additionally moreover furthermore ultimately journey""".split()

P1_PHRASES = [
    "in today's fast-paced", "in a world where", "now more than ever", "picture this",
    "here's the thing", "here's why", "let's dive", "let's be honest", "the truth is",
    "it turns out", "without further ado", "let that sink in", "read that again", "full stop",
    "make no mistake", "it's worth noting", "it is worth noting", "it's important to note",
    "at the end of the day", "when it comes to", "at its core", "the reality is",
    "in conclusion", "the future looks bright", "exciting times ahead", "the possibilities are endless",
    "stands as a testament", "a testament to", "plays a key role", "plays a pivotal role",
    "marks a pivotal", "setting the stage", "more than just", "your journey", "our journey",
    "don't miss out", "treat yourself", "awaits you", "you deserve", "elevate your",
    "whether you're", "serves as", "stands as",
]

P0_PHRASES = [
    "i hope this helps", "great question", "certainly!", "absolutely!", "happy to help",
    "let me know if you", "feel free to", "don't hesitate to", "as of my last",
    "as an ai", "i cannot browse", "experts agree", "studies show", "customers love",
    "last chance", "act now", "hurry", "limited time only", "while supplies last",
]

ARABIC_PHRASES = [
    "في عالمنا اليوم", "في ظل التطورات", "لا شك أن", "مما لا شك فيه", "علاوة على ذلك",
    "بالإضافة إلى ذلك", "فضلاً عن", "من ناحية أخرى", "نقلة نوعية", "حجر الزاوية",
    "دوراً محورياً", "دورا محوريا", "فريدة من نوعها", "فريد من نوعه", "لا مثيل له",
    "ليس مجرد", "سارع", "لا تفوت", "ولا تفوّت", "قم بالضغط", "قم بالتسجيل", "عميلنا العزيز",
    "نتطلع لخدمتكم",
]

CONTRAST_RES = [
    (r"\bnot (?:just|only|merely|simply)\b", "not just/only X (but Y)"),
    (r"\b(?:it's|it is|this is|that's|that is) not\b[^.!?]{0,80}[,;.]\s*(?:it's|it is|but|this is)\b", "it's not X, it's Y"),
    (r"\b(?:isn't|aren't|wasn't|weren't|is not|are not)\b[^.!?]{0,60}\.\s+[A-Z][^.!?]{0,40}\b(?:is|are|was|were)\.", "X isn't..., Y is."),
    (r"\bnot because\b", "not because X, because Y"),
    (r"\bdoesn't mean\b[^.!?]{0,80}[.;,]\s*(?:it|this) means\b", "doesn't mean X. It means Y."),
    (r"\w, not (?:a |an |the |just )?\w+", "X, not Y"),
    (r"\brather than\b", "X rather than Y"),
    (r"\bless about\b[^.!?]{0,60}\bmore about\b", "less about X, more about Y"),
]

ALLOWED_CAPS = {"EGP", "USD", "EUR", "SAR", "AED", "OK", "FAQ", "SMS", "URL", "API", "PDF", "USA",
                "UK", "UAE", "ID", "VAT", "TV", "DIY", "XL", "XXL", "XS", "CEO", "HTML", "CSS", "AI", "DTF", "GSM"}

EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF✨✦✧⭐⬆⬇➡]"
)


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("style", "script", "head"):
            if tag != "head":
                self.skip += 1
        a = dict(attrs)
        if tag == "img" and a.get("alt"):
            self.parts.append("\n[alt] " + a["alt"] + "\n")
        if tag in ("p", "div", "td", "tr", "br", "h1", "h2", "h3", "h4", "li", "table", "title"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("style", "script") and self.skip:
            self.skip -= 1
        if tag in ("p", "div", "td", "tr", "h1", "h2", "h3", "h4", "li", "title"):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

    def handle_comment(self, data):
        # Keep subject/preheader notes that live in comments.
        if re.search(r"(?i)subject|preheader", data):
            self.parts.append("\n" + data + "\n")


def to_text(raw):
    if re.search(r"<(?:html|table|body|div|p|td)\b", raw, re.I):
        p = TextExtractor()
        p.feed(raw)
        txt = "".join(p.parts)
    else:
        txt = raw
    txt = html.unescape(txt).replace(" ", " ")
    lines = [re.sub(r"[ \t]+", " ", l).strip() for l in txt.splitlines()]
    return [l for l in lines]


def scan(lines):
    hits = []

    def add(tier, lineno, kind, snippet):
        hits.append({"tier": tier, "line": lineno, "kind": kind, "text": snippet[:140]})

    word_re = re.compile(r"\b(" + "|".join(re.escape(w) for w in P1_WORDS) + r")\b", re.I)
    prev_short = 0
    for i, line in enumerate(lines, 1):
        if not line:
            prev_short = 0
            continue
        low = line.lower().replace("’", "'")
        for ch, name in (("—", "em dash"), ("–", "en dash")):
            if ch in line:
                add("P1", i, name, line)
        if re.search(r"\s--\s", line):
            add("P1", i, "double-hyphen dash", line)
        for ph in P0_PHRASES:
            if ph in low:
                add("P0", i, f'phrase "{ph}"', line)
        for ph in P1_PHRASES:
            if ph in low:
                add("P1", i, f'phrase "{ph}"', line)
        for ph in ARABIC_PHRASES:
            if ph in line:
                add("P1", i, f'Arabic phrase "{ph}"', line)
        for m in word_re.finditer(line):
            add("P1", i, f'AI word "{m.group(1).lower()}"', line)
        for rx, name in CONTRAST_RES:
            if re.search(rx, line, re.I):
                add("P1", i, f"contrast: {name}", line)
        if EMOJI_RE.search(line):
            add("P1", i, "emoji / ornament symbol", line)
        if "→" in line:
            add("P2", i, "arrow as decoration", line)
        caps = [w for w in re.findall(r"\b[A-Z][A-Z']{2,}\b", line) if w not in ALLOWED_CAPS]
        if len(caps) >= 2:
            add("P1", i, "ALL CAPS run", line)
        if line.count("!") >= 1:
            add("P2", i, f"exclamation x{line.count('!')}", line)
        if re.search(r"[“”]", line):
            add("P2", i, "curly quotes", line)
        # Triad: "A, B, and C" / "A, B and C" with short items.
        if re.search(r"\b\w+(?: \w+)?, \w+(?: \w+)?,? (?:and|&) \w+(?: \w+)?\b", line):
            add("P2", i, "possible triad (check it has 3 real items)", line)
        # Dramatic fragments: several very short sentences in one line.
        sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", line) if s.strip()]
        short = [s for s in sents if len(re.findall(r"\w+", s)) <= 3]
        if len(sents) >= 2 and len(short) >= 2:
            add("P1", i, "dramatic fragments", line)
        # One-line punchy paragraph after another short one.
        n_words = len(re.findall(r"\w+", line))
        if n_words <= 4 and line.endswith(".") and prev_short:
            add("P2", i, "stacked short lines", line)
        prev_short = 1 if (n_words <= 4 and line.endswith(".")) else 0
        # Markdown Title Case heading.
        mh = re.match(r"#{1,6}\s+(.*)", line)
        if mh:
            words = [w for w in re.findall(r"[A-Za-z][\w']*", mh.group(1)) if len(w) > 3]
            if len(words) >= 3 and all(w[0].isupper() for w in words):
                add("P2", i, "Title Case heading", line)
        if re.search(r"\*\*[^*]{1,40}:\*\*", line):
            add("P1", i, "bold-label list item", line)
    return hits


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    sources = [(f, open(f, encoding="utf-8").read()) for f in args.files] or [("<stdin>", sys.stdin.read())]
    report = []
    for name, raw in sources:
        lines = to_text(raw)
        hits = scan(lines)
        words = sum(len(re.findall(r"\w+", l)) for l in lines)
        report.append({"file": name, "words": words, "hits": hits})
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    for r in report:
        counts = {t: sum(1 for h in r["hits"] if h["tier"] == t) for t in ("P0", "P1", "P2")}
        print(f"== {r['file']}  ({r['words']} words)  P0:{counts['P0']}  P1:{counts['P1']}  P2:{counts['P2']}")
        for h in sorted(r["hits"], key=lambda h: (h["tier"], h["line"])):
            print(f"  {h['tier']}  line {h['line']:>4}  {h['kind']}\n          {h['text']}")
        if not r["hits"]:
            print("  clean: no mechanical tells found (still read it aloud)")


if __name__ == "__main__":
    main()
