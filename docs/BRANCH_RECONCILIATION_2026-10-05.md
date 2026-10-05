# Mushroom branch reconciliation — 2026-10-05

Baseline: `origin/main` `d15143cc21c987e42b933887c11f501a32cab80b`.
This review does not deploy a website, change phone configuration, or enable
visual recovery on additional devices.

## Scorpio recovery: integrate through a new PR

The new main-based branch includes both original commits `ecc5d41` and
`87388b8`. The second was local-only before this integration. The WORKLOG
conflict was resolved by retaining both the main Nashville entry and the
Scorpio entry; no event catalogue or site code was changed.

Recovery remains opt-in. The classifier selects exact 1440x3120 or 1220x2712
profiles; unsupported or changed screens remain unknown. Two agreeing fresh
captures, foreground and manual-pause checks precede each action. This does not
prove that every device with the same resolution or a later game UI is safe.

Local checks on this main-based tree:

- ARM64 NDK r27d build with `-O2 -Wall -Werror` reproduced the committed
  `phone_agent/bin/ui-probe` SHA-256:
  `bcb3ab43211ff38e9395d70cbea84044e3eb0bdcdb2ae51ed8c53a235cfcca42`.
- NDK x86_64 static build executed under WSL: existing Libra, Scorpio and
  restricted-notice synthetic fixtures passed.
- Visual recovery, map-entry, control, power-guard, power-guard integration
  and upload-chunk shell regressions passed.
- Private device captures and object/upload/ACK evidence are historical
  2026-10-01/02 evidence described in [SCORPIO_UI_RECOVERY.md](SCORPIO_UI_RECOVERY.md),
  not a new device test on 2026-10-05 or a long-duration acceptance.

Merge remains conditional on the new PR's required `validate` check against
its exact HEAD and an unchanged main baseline (or revalidation after updating).
No deployment follows automatically from merging this PR.

## Old report branch: retain, do not merge wholesale

`fix/report-verification-level` at `96ba9a6` changes eight files, including
old native source, SO/ZIP artifacts, Agent packaging and task API fields.
Its individual changes are not all present on main:

| Old change | Main disposition | Follow-up |
| --- | --- | --- |
| Verification cooldown cap at 20 s | Main honors the selected `base_cooldown_s`, no longer injects distance cooldown | Do not restore the old override without a new requirement |
| Virtual-display shell-function timeout fix | Main uses `run_as_shell_timeout` for both display queries | Superseded; do not remove bounded execution |
| Fresh evidence before verification eligibility | Main binds observations to the exact target lease and current challenge in `site/lib/fleet.ts` | Preserve this stronger attribution; generic new-row counts do not prove the requested mushroom was observed |
| Fourth teleport field forcing unchanged observations | Not present: main native reads three fields and task response has fourteen fields | Real remaining candidate, requiring a separate main-based API/Agent/native design, dedupe and exact-target tests, and one-device acceptance; not implemented here |
| Zero-row verification cold restart | Not present as a verification-specific rule; main has marker/query-only/visual recovery | Evaluate only with target-attributed failure evidence; do not add unconditional restarts |
| Agent customize/package scripts | Not present at these paths; old installer covers only a historical file set | Not a ready modern installer; review all persistent files and current assets separately before reuse |

The old branch is retained for reference. No old binary, installer, verification
protocol or cooldown policy is imported by the Scorpio PR. Further work on the
fresh-observation candidate needs a separate scoped work order; this audit is
not permission to deploy it.
