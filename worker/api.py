"""Optional Mode B Cloud Queue client for Aether Studio v2.0 Colab Worker."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


def _post_json(url: str, payload: dict[str, Any], token: str | None = None) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def claim_job(origin: str, pairing_code: str) -> dict[str, Any]:
    url = f"{origin.rstrip('/')}/api/2d/worker/claim"
    return _post_json(url, {"pairing_code": pairing_code.strip()})


def send_heartbeat(origin: str, capability_token: str, phase: str, message: str) -> None:
    if not origin or not capability_token:
        return
    url = f"{origin.rstrip('/')}/api/2d/worker/heartbeat"
    try:
        _post_json(url, {"phase": phase, "message": message}, token=capability_token)
    except urllib.error.URLError:
        pass


def complete_job(
    origin: str,
    capability_token: str,
    status: str,
    report: dict[str, Any],
) -> None:
    if not origin or not capability_token:
        return
    url = f"{origin.rstrip('/')}/api/2d/worker/complete"
    try:
        _post_json(url, {"status": status, "report": report}, token=capability_token)
    except urllib.error.URLError:
        pass
