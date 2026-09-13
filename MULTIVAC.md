# Multivac OpenChamber fork

Upstream is pinned to `openchamber/openchamber@961f1611cb50cb7dd8d24c82e688ca6d8eef37bb`.
The companion OMP baseline is `can1357/oh-my-pi@bdb9510b06824280cec9d05f3e5a45ce74289263`.
Both upstream remotes and licenses are retained.

This port is in development. It is not deployed at `omp.multivac.club` and must
not be publicly exposed until backend owner authentication and workflow parity
are complete. Existing agent/command/MCP configuration surfaces still require
native OMP mappings; a visible upstream control is not evidence that it is ported.

## Isolated development

Run `C:\Users\neri\arrstack\scripts\start-omp-development.ps1` under PowerShell 7.
The launcher starts OMP RPC hosting on private loopback port 4407 and this browser
server on loopback port 4408. State lives in the ACL-restricted arrstack
`appdata/omp-development` directory. Use the launcher's `-Stop` switch to stop
only its recorded development processes.

`OPENCHAMBER_AGENT_RUNTIME=omp` routes utility calls through OMP's private
authenticated endpoint. Credential selection, quota polling and cooldowns stay
inside OMP. Providers settings includes the shared Go credential pool dashboard.
Keys are submitted to the server and never returned in pool summaries.

The development browser has no production Google/owner gate yet. Keep it on
loopback. The private OMP server independently requires its generated password
and rejects browser Origin headers.

## Verification checkpoint

- UI type check and web build passed.
- Small-model tests: 30 passing, including OMP routing and output reservations.
- Proxy tests: 14 passing. A browser save persisted the sticky policy, and the
  default most-headroom policy was restored afterward. Cross-origin writes return 403.
- Dead-code scan found no unused added pool/utility exports; upstream findings remain.
- Existing upstream anti-slop lint findings remain in utility/provider modules.
- Companion OMP tests cover pool failover, real RPC streaming, cancellation,
  questions, denied approvals, nested subagents, persistence and writer exclusion.

Full browser workflow, owner authentication, compiled-binary, rollback and public
access validation are still required. See the companion OMP `MULTIVAC.md` for
the remaining work and installation backup status. Infrastructure belongs in arrstack.
