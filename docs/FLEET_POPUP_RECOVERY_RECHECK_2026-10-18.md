# Popup recovery recheck, 2026-10-18 Asia/Taipei

At 06:08 Aries, Cancer and Libra showed the map without a modal. The existing
04:00 rotation job325 had completed553/553 points and these three agents were
idle. Their last local logs contained positive object refreshes and accepted
uploads, followed by several zero-row timeouts; these are not fresh acceptance
proofs. No replacement job or rotation change was made for testing.

Leo's LAN address changed. After matching its serial and original Agent ID,
the 06:11 capture showed the do-not-drive modal. The deployed classifier returned
`unknown` for that real frame. Its text/button rendering differed from the Aries
calibration even at the same1080x2400 resolution. Leo had46 consecutive zero-row
targets and its recent heartbeat did not establish working scans.

Agent2.2.3 adds separate samples from Leo's actual driving notice and subsequent
dashboard. Frame, text and button groups retain the existing exact sample count
and RGB tolerance; no generic notice fallback or relaxed threshold was added.
The new binary classified the retained driving frame as `driving 539 1256` and
the dashboard as `dashboard 540 2165`, while the old binary returned unknown.
Private full frames remain outside Git; only public UI samples are included.

Recovery logging now distinguishes input from outcome. After each input the
Agent rechecks protection and classifies a fresh frame. An unchanged notice is
logged as unconfirmed and is not clicked repeatedly within that pass. A changed
or unknown frame is not called a recovered map. Focus is checked again after
the final protection check. Behavioral tests cover ignored taps, unknown outcome,
focus changes during the guard and protection activating after input.

Before deployment, root-private phone archives retain the complete Agent/Hunter
directories and original TSV; quiesced snapshots also preserve config, token,
offset and pending state. Only the Agent default/version override, popup helper
and standalone classifier change. Game155.0 and Hunter155.0-r1 stay installed.
Cancer's60-percent threshold and Libra's compass tap/disabled control core remain.

At06:21 all four newly captured screens were maps without a modal and all four
owned Agent processes were running2.2.3 with the same helper/probe hashes. Leo
had resumed several successive formal recheck targets on the existing job325:

| Target ID | Fresh source | New rows | New bytes | Cloud ACK |
| --- | --- | --- | --- | --- |
|1491928|object|8|877|HTTP200|
|1491926|object|5|520|HTTP200|
|1491925|object|6|654|HTTP200|
|1491923|object|7|728|HTTP200|

Each was accompanied by accepted upload requests from the original Leo identity
and Agent2.2.3. Zero-row timeouts before dashboard recovery were excluded. At the
final audit Leo's TSV offset had advanced to58406641. Aries, Cancer and Libra
remained idle after the553-point rotation; no new post-update multi-target claim
is made for those three. Their next automatic rotation remains12:00. This check
does not establish24-hour stability.

Each phone's protected backup folder is under
`/data/adb/pikmin-private-backups/`, with both `before-maintenance.tar` and a
verified `quiesced.tar`:

| Phone | Backup folder |
| --- | --- |
|Leo|popup223-leo-f40b1e06-20261018-061344|
|Aries|popup223-aries-7lw8ibvghe6dtof6-20261018-061956|
|Cancer|popup223-cancer-8ADX0QS09-20261018-062020|
|Libra|popup223-libra-1A041FDEE004AR-20261018-062040|

The original config byte prefix and token/TSV/offset/pending hashes were checked
before restart. Cancer still has `POWER_GUARD_RESUME_BATTERY_PERCENT=60`; Libra's
disabled control core flag retains its2026-10-14 timestamp. Original game/Hunter
versions and the native library hash remain unchanged on all four phones.

Validation:64 ARM64 classifier fixtures; the actual Leo warning and three
separate dashboard captures; all phone shell suites and all four staged Agent
variants; site build and108 tests under Node24; production dependency audit0.
Final popup-probe SHA256:
`c5a222c170777ee3394379d1e750d11b838aa03b41a11243a1959de2ac80f302`.
No Site source or production deployment changed.
