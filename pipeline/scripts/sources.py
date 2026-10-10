"""Look up the cached text of a source page (Tavily extract results saved in raw/tavily/)."""
import glob, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
_INDEX = None


def _index():
    global _INDEX
    if _INDEX is None:
        _INDEX = {}
        for f in sorted(glob.glob(str(ROOT / "raw" / "tavily" / "extract_*.json"))):
            for r in json.load(open(f)).get("results", []):
                _INDEX[r["url"].rstrip("/")] = r["raw_content"]
    return _INDEX


def text(url):
    return _index().get(url.rstrip("/"), "")


def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[*_#|\\]", " ", s)).strip().lower()


def contains(url, quote):
    """True if the quote appears in the cached page text (whitespace/markdown-insensitive)."""
    return norm(quote) in norm(text(url))
