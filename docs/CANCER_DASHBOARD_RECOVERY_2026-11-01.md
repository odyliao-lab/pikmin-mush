# Cancer dashboard compass recovery — 2026-11-01

Cancer's last accepted data was17:53 Taipei. Four hours later its authenticated
metrics showed106 consecutive no-data targets, no captured rows in the last
hour and no upload failures. Local TSV size equalled the upload cursor. Public
HTTPS worked, stock thermal status was0, and the original60-percent guard hash
was unchanged. This was missing scan data, not a backlog of unsent TSV.

Fresh screens showed the known danger notice followed by the MTK Ody dashboard.
The installed Agent2.2.5 already dismissed the notice, but classified the
dashboard as unknown and repeatedly used the original300-second cold fallback.
Game156/code1792142832 and Hunter156-r1 were retained.

## Reproduced classifier failure

On five current1080x2160 native frames, all64 frame and96 text samples matched.
The compass sample at580/1967 expected RGB41/125/90 but observed33/158–162/74–82.
Its maximum channel difference37 exceeded the unchanged24-channel threshold.
That sample lies on the translucent compass edge, over animated flower scenery.
One failed sample safely rejected the whole dashboard; restarting did not fix it.

Only Cancer's `p8_button` calibration changes. It now contains32 white glyph
and32 green negative-space samples inside radius31 of540/1925, selected for
stability across those five frames. Existing frame/text samples, translation
rules, two fresh agreeing frames, focused-window requirement, pause/thermal
guards and color tolerance are unchanged. No account, date, step count, avatar
or private screenshot enters the repository. Other device templates are unchanged.

The packaged ARM64 popup-probe is rebuilt from these exact sources so a future
Agent package does not restore the old compass samples. It is a read-only UI
classifier, separate from Hunter, game/native hooks and Cancer's scoped uploader.

## Validation and deployment boundary

The candidate passed127 positive, negative, translated and changing-scenery
fixtures on Cancer, plus all five private captured dashboard frames. Regression
coverage changes the former failing edge pixel and the surrounding scenery
without authorizing white circular controls, green blobs or incomplete text.
Popup-recovery, focused-window, protection, input-result, persistent cold-start
throttle and map-entry tests pass. Full Linux CI is a separate release gate.

Only the verified Cancer classifier may be replaced, after a new verified
on-device root-only backup. Do not replace its Agent/upload/auth/guard scripts,
credentials, pending ACK or offsets, or change60-percent recovery/native15FPS.
Replacing the executable does not require another game or Agent restart: the
existing periodic popup check invokes it afresh.

Screen classification or a successful tap is not scan recovery. Formal recovery
still requires at least three different new production targets with current-PID
object events, nonzero TSV, upload and successful ACK, corroborated by Site
acceptance. Detailed deployment/acceptance evidence stays in the private
`pikmin-operations/2026-11-01/cancer-upload` directory.
