"""
db_client.py — HTTP API wrapper for reading/writing experiment data via the web app DB.

All Python experiment scripts use this module instead of reading/writing local files.
The web app exposes REST endpoints; this module wraps them.

Environment:
    SYNC_API_URL — base URL of the web app (default: http://localhost:3000)
"""

import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import quote

API_BASE = os.environ.get("SYNC_API_URL", "http://localhost:3000")


def get_experiment(project_id: str, slug: str) -> dict:
    """Fetch an experiment record from the database by project ID and slug."""
    url = f"{API_BASE}/api/projects/{quote(project_id, safe='')}/experiment?slug={quote(slug, safe='')}"
    req = Request(url, method="GET")
    try:
        with urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        body = e.read().decode() if e.fp else ""
        raise RuntimeError(f"GET {url} → {e.code}: {body}") from e


def upsert_experiment(project_id: str, slug: str, data: dict) -> dict:
    """Create or update an experiment record in the database."""
    url = f"{API_BASE}/api/projects/{quote(project_id, safe='')}/experiment"
    payload = json.dumps({"slug": slug, **data}).encode()
    req = Request(url, data=payload, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        body = e.read().decode() if e.fp else ""
        raise RuntimeError(f"POST {url} → {e.code}: {body}") from e
