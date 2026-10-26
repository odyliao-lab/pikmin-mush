# Four-phone popup recovery validation

Agent2.2.2 adds opt-in phone-local `POPUP_RECOVERY_ENABLED=1` with a30-second
minimum interval between checks. No PC watcher, new cloud node or Site deployment
is required. The game and Hunter remained155.0/155.0-r1 on all four phones.

The classifier checks independent modal-frame, public text and button samples.
Two fresh classifications must agree and the focused window must be the exact
game package before each input. A newly classified dashboard uses its calibrated
compass tap. Unknown screens, other apps, permissions, login and payment screens
receive no recovery input. Manual pause and thermal/charging gates are checked
before capture and again before input. While enabled, legacy guessed keys/taps/
swipes are suppressed. Existing recovery remains available when opted out.

| Phone | Physical capture | Initial screen | Live validation |
| --- | --- | --- | --- |
| Aries |1080x2400|Do-not-drive notice|Controlled cold start produced the retained restricted-area notice; Agent dismissed it and then tapped the classified dashboard compass. Subsequent targets captured7,8,13 rows with upload/ACK.|
| Cancer |1080x2160|Map, no popup|No spurious recovery input on the map; subsequent targets captured11,6,9 rows with upload/ACK.|
| Leo |1080x2400|Speed-restriction notice|The actual pending notice was automatically dismissed; subsequent targets captured4,3,1 rows with upload/ACK.|
| Libra |1440x3120|Map, no popup|Fresh155 dashboard matched the existing compass calibration; Agent returned to the map and subsequent targets captured10,5,9 rows with upload/ACK.|

At23:02 Asia/Taipei all four newly captured screens were maps without a modal.
Acceptance used fresh object markers, TSV growth, accepted uploads and authenticated
HTTP200 ACKs on the existing job323; heartbeat and zero-row ACKs were not counted.
The initial zero-row Libra target during dashboard calibration was excluded.
This was a short acceptance run, not a24-hour stability claim.

Before each deployment a root-private phone backup retained Agent/Hunter, config,
token when stored separately, TSV, offset and pending state. Existing phone script
differences were retained with a narrowly scoped feature patch. Only feature enable,
interval and Agent-version overrides were appended to config; the full original
byte prefix was compared on-phone, preserving inline credentials too. No phone
credential/config was exported. Libra retained its compass-tap setting and disabled
Control Center core. Cancer retained its60-percent recovery threshold. Scorpio and
Discord were untouched. Private screenshots and detailed receipts stayed outside Git.

Validation:54 positive/negative/translated classifier fixtures on ARM64; all phone
shell suites; four staged-script safety tests; deployment/process-identity tests;
site build and108 tests under bundled Node24; production audit0 vulnerabilities.
The same popup-probe build reproduced SHA256
`651d63e8ed95db3a247253e9d473c9d36a63d6ef5d8ef467c467f8f18a7d89e9` using NDKr27d.
An older local Node22.17 failed the existing numbered-SQLite-binding fixture;
the failure was retained and the supported Node24 run passed without changing site
source or weakening assertions.
