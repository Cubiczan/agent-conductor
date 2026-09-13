"""agent-conductor decision engine bridge.

Exposes the published Consensus Hardening Protocol (CHP) package
(`consensus-hardening-protocol` on PyPI, import path `chp`) over a
newline-delimited JSON protocol on stdin/stdout, so the TypeScript MCP
server can gate decisions without an HTTP dependency.

Request:  {"id": <any>, "method": "<name>", "params": {...}}
Response: {"id": <any>, "result": {...}} | {"id": <any>, "error": "<message>"}

Methods:
    ping       -> {"ok": true, "engine": "chp", "version": ...}
    r0_gate    -> params: solvable, scoped, valid, worth_it (booleans)
                  result: {"verdict": "PASS"|"HALT", "results": {...}}
    adversary  -> params: claim (str), context (str, optional),
                  high_stakes (bool, default true)
                  result: {"status", "foundation_score", "findings",
                           "verification_failures", "report"}

Run: python3 engine/bridge.py   (reads stdin until EOF)

Requires: pip install -r engine/requirements.txt
"""
from __future__ import annotations

import json
import sys
from importlib.metadata import PackageNotFoundError, version

from chp.gates import evaluate_r0_gate
from chp.runner import TriangulationRunner


def _package_version() -> str:
    try:
        return version("consensus-hardening-protocol")
    except PackageNotFoundError:
        return "unknown"


def handle_ping(params):
    return {"ok": True, "engine": "chp", "version": _package_version()}


def handle_r0_gate(params):
    gate = evaluate_r0_gate(
        solvable=bool(params.get("solvable", False)),
        scoped=bool(params.get("scoped", False)),
        valid=bool(params.get("valid", False)),
        worth_it=bool(params.get("worth_it", False)),
    )
    return {"verdict": gate.verdict.value, "results": gate.results}


def handle_adversary(params):
    claim = params.get("claim")
    if not claim:
        raise ValueError("'claim' is required")
    result = TriangulationRunner.as_adversary(
        claim,
        context=params.get("context", ""),
        high_stakes=bool(params.get("high_stakes", True)),
    )
    verification_failures = (
        result.verification.failures() if result.verification else []
    )
    return {
        "status": result.status.value,
        "foundation_score": result.report.case.foundation_score,
        "findings": list(result.adversary_findings),
        "verification_failures": verification_failures,
        "report": result.render(),
    }


HANDLERS = {
    "ping": handle_ping,
    "r0_gate": handle_r0_gate,
    "adversary": handle_adversary,
}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            handler = HANDLERS.get(request.get("method"))
            if handler is None:
                raise ValueError(f"unknown method: {request.get('method')!r}")
            response = {"id": request_id, "result": handler(request.get("params") or {})}
        except Exception as exc:  # surface every failure to the client, keep serving
            response = {"id": request_id, "error": str(exc)}
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
