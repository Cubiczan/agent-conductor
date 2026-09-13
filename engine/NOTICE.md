# Decision engine attribution

Agent Conductor no longer vendors a copy of the Consensus Hardening Protocol.

The MCP `decision_*` tools call the published package:

- PyPI: [`consensus-hardening-protocol`](https://pypi.org/project/consensus-hardening-protocol/)
- Source: [`icohangar-ops/consensus-hardening-protocol`](https://github.com/icohangar-ops/consensus-hardening-protocol)
- License: MIT

Install with:

```bash
pip install -r engine/requirements.txt
```

`engine/bridge.py` is the local NDJSON adapter; CHP implementation lives in the package.
