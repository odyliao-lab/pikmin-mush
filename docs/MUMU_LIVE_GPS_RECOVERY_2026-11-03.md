# MuMu GPS loss during an existing Agent session

The three Taichung scanners lost their live game and GPS manager while the
boot-started Agents continued running. Only the passive provider remained.
New claims repeatedly failed the system GPS write before reaching
`ensure_game_running`; several hundred failed targets accumulated per hour.
Root diagnostic access and the Shell mock-location AppOp were independently
checked, so a working heartbeat or Shell authorization was not scan recovery.

When an opted-in MuMu scanner's GPS write fails, reuse the existing guarded
provider bootstrap, then retry exactly the same coordinate once. The bootstrap
starts the existing game when needed and requires MuMu's real GPS manager before
creating its mock provider. Pause/stop/native readiness remain in that existing
path; failed bootstrap or second write remains a failed scan, never a success.
Other devices retain their original first-write failure behavior.

This does not change game, Hunter, Agent version, authentication, upload,
qualification, routes, targets, restart throttling or any notification schedule.
Any device activation is a scoped function replacement after a fresh verified
root-only guest backup; do not overwrite the full Agent or its local differences.
Formal acceptance still needs new current-PID objects, nonzero TSV, upload and
successful ACK corroborated by Site acceptance. Detailed live results stay in
the private November3 local-fleet-recovery operation record.
