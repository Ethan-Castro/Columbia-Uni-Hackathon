"""Thin Tavily client. Caches every response as JSON in raw/tavily/ so reruns are free and auditable."""
import hashlib, json, os, pathlib, requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "raw" / "tavily"
CACHE.mkdir(parents=True, exist_ok=True)

def _key():
    if os.environ.get("TAVILY_API_KEY"):
        return os.environ["TAVILY_API_KEY"]
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("TAVILY_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("TAVILY_API_KEY missing (set env var or pipeline/.env)")

def _call(endpoint, payload):
    h = hashlib.sha1(json.dumps([endpoint, payload], sort_keys=True).encode()).hexdigest()[:16]
    path = CACHE / f"{endpoint}_{h}.json"
    if path.exists():
        return json.loads(path.read_text())
    r = requests.post(f"https://api.tavily.com/{endpoint}", json=payload,
                      headers={"Authorization": f"Bearer {_key()}"}, timeout=90)
    r.raise_for_status()
    data = r.json()
    data["_request"] = payload
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    return data

def search(query, max_results=8, **kw):
    return _call("search", {"query": query, "max_results": max_results, "search_depth": "advanced", **kw})

def extract(urls):
    return _call("extract", {"urls": urls if isinstance(urls, list) else [urls]})
