# Multivac OpenChamber fork

Upstream is pinned to `openchamber/openchamber@961f1611cb50cb7dd8d24c82e688ca6d8eef37bb`.
The companion OMP baseline is `can1357/oh-my-pi@bdb9510b06824280cec9d05f3e5a45ce74289263`.
Both upstream remotes and licenses are retained.

## Production status (2026-09-13)

This port is deployed at `https://omp.multivac.club/` with OMP as its runtime.
Google authentication and the single-owner homelab allowlist protect the UI,
APIs, streams, terminals, previews, and WebSocket upgrades. The backend remains
loopback-only and independently verifies Caddy's protected identity and proxy
secret. Native agent, command, MCP, OAuth, and credential-pool settings are live.

Public acceptance covered files, terminal commands, Git review, worktree
controls, goals, schedules, multi-run, GitHub PR status, a zero-cost OMP command
with restart/reconnect persistence, and a real embedded preview through
`https://p-8123.omp-preview.multivac.club/`. The preview fixture was stopped.
The final web build and UI type check pass. All 447 UI test files passed; the
web suite passed apart from one transient Windows `EPERM` rename that passed
10/10 when rerun alone.

The companion executable is `omp/18.1.18`, SHA-256
`2738EA4C625ABAC7A1E73E7F0C64CA368C5283D5FC59D74FE390CAD34C6E260B`.
Deployment, backups, and rollback are documented in
`C:\Users\neri\arrstack\DOMAIN.md`.

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

The isolated development browser remains loopback-only. Production uses the
owner gate described above. The private OMP server independently requires its
generated password and rejects browser Origin headers.

## Verification checkpoint

- Native agent Markdown editing, duplication, save, reload, and rename were exercised
  in the isolated browser. The staged `scout-browser-probe` definition retains the
  source agent's native tools, output schema, model, and prompt. No model request
  was made for this check. Native deletion has runtime coverage but still needs a
  browser check. The default `build` settings mapping and settings search remain open.
- OMP native discovery now respects its configured agent directory; the staged
  browser and native workers no longer discover user definitions from the default path.
- Current OMP adapter suite: 6 passing tests, 112 assertions. Configuration discovery:
  5 passing tests. OMP and UI type checks passed; this is not full workflow validation.

- UI type check and web build passed.
- Small-model tests: 30 passing, including OMP routing and output reservations.
- Proxy tests: 14 passing. A browser save persisted the sticky policy, and the
  default most-headroom policy was restored afterward. Cross-origin writes return 403.
- Dead-code scan found no unused added pool/utility exports; upstream findings remain.
- Existing upstream anti-slop lint findings remain in utility/provider modules.
- Companion OMP tests cover pool failover, real RPC streaming, cancellation,
  questions, denied approvals, nested subagents, persistence and writer exclusion.

Full browser workflow, owner authentication, compiled-binary, rollback, and
public-access validation are recorded in the production status and companion
OMP `MULTIVAC.md`. Infrastructure belongs in arrstack.

### Native MCP session validation

The session MCP panel now reloads configuration through OMP RPC. Browser validation
disabled the fixture in native configuration, reloaded to 0/0, restored it, and
reloaded to 1/1. The fixture was restored. The shared CLI/RPC implementation rejects
active sessions and clears stale tools after rediscovery failures. Native settings
still save without disrupting live sessions; use the session reload control to
apply changes to an idle worker. Build and type checks pass.

Native MCP Settings now routes OMP instances to a scoped JSON editor instead of
OpenCode configuration. It creates, patches, and deletes native entries, keeps
connection values write-only, clears entered values after saving, and protects
unsaved edits when switching its scope or server selector. The native settings
sidebar retains project selection. Settings search filters MCP targets by runtime.
All new copy is translated in 12 locales. Browser create, timeout-only edit, delete,
and project-scope selection passed against isolated state. The edit preserved the
stored command, arguments, and environment value; save cleared those values from
the editor. The test entry was removed. A dropdown display-label correction is
rebuilding in `native-mcp-settings-build-3.log` in arrstack's development directory.
Screenshot capture remains unavailable; accessibility-tree checks passed.
Search tests pass (6 tests, 15 assertions), the
corrected locale type check passes, and scoped new-component lint is clean.

The complete current OMP adapter test file passes 7 tests (136 assertions), covering
the private API, native MCP connections, command/session persistence, shell-agent
attribution, startup cleanup, quota failures, streaming and reconnect behavior.

The work-status MCP panel now reads the configuration store's project agent roster
to select OMP controls. The sync store's unused agent field cannot identify the runtime.
The staged browser displayed `browser_probe`, disconnected it, and reconnected it;
the session API confirmed its registered tool disappeared and returned respectively.
No model request was needed. MCP configuration editing was subsequently verified above.
Native MCP settings now offer authorization, a login link, cancellation and server-status
polling. Reopening retrieves the existing attempt through scoped GET; polling never
resends authorization starts. Scoped component lint passes. Browser OAuth validation
now passes with a local-only PKCE provider: authorization link, callback through the
browser proxy, redirect to settings and completion in the original polling page.
The current successful build log is `native-mcp-oauth-build-2.log` in the isolated staging
directory. Backend restart discards pending OAuth attempts; it preserves stored credentials.

The configuration-store suite passes 55 tests (191 assertions), the UI type check
and web build pass, and the MCP component passes scoped lint. The dead-code scan
reports no unused MCP panel or agent-selector exports; existing store lint findings
remain. Later live acceptance established browser and production readiness.

The optional owner ingress gate is now wired before HTTP route registration and
Node upgrade listeners. Its five tests include an actual HTTP server: unauthenticated
page/API/event/preview/terminal paths are rejected, cross-origin upgrades never reach
the upgrade listener, and accepted upgrades have ingress credentials removed.
Live acceptance subsequently verified Caddy header replacement, private
connectivity, owner allowlist loading, and production route coverage. Public
ingress is enabled at the hostname above.
