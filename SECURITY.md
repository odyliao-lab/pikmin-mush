# Security operations

## Trust boundaries

- `/api/mushrooms` is public. It exposes mushroom records, aggregate fleet
  availability, and coarse country/city progress only. Agent identifiers,
  exact Agent locations, target IDs, counters, and versions belong in the
  authenticated admin API.
- `/api/agent/**` is device-facing. Each fleet Agent uses its own credential;
  `AGENT_TOKEN` remains only for the legacy primary Agent until it is migrated.
- `/api/controller/**` is maintenance-only and requires `CONTROLLER_TOKEN`.
  It must never reuse `AGENT_TOKEN`.

## Required hosted secrets

The Sites deployment must have both values before this security release is
published:

- `AGENT_TOKEN`: existing primary Agent secret.
- `CONTROLLER_TOKEN`: a new, independent random value of at least 32 bytes.

Store the same controller value on a Windows maintenance host in the ignored
`scanner/controller_token.txt` file. Restrict that file to the current Windows
user, SYSTEM, and Administrators. The normal Android fleet does not need this
secret.

Generate a controller token with a cryptographically secure password manager
or equivalent operating-system tool. Do not place it in command history,
screenshots, logs, GitHub issues, or pull requests.

## Deployment checklist

1. Create and store a new `CONTROLLER_TOKEN` in Sites.
2. Place it in `scanner/controller_token.txt` only on hosts that run the legacy
   Windows controller.
3. Build and deploy the validated Sites version.
4. Confirm the public mushrooms response has no `agents` array or exact Agent
   location.
5. Confirm a request larger than 512,000 bytes to the upload route receives
   HTTP 413 and an invalid controller token receives HTTP 401.
6. Confirm both real Agents can upload a 262,144-byte chunk and continue their
   existing target lease/ACK flow.
7. Confirm the public map receives CSP, HSTS, `nosniff`, frame denial, referrer,
   and permissions-policy headers.

## Secret response

If an Agent credential may have been disclosed, pause or disable that Agent,
rotate its credential, update only that device, confirm the new credential is
reporting, and immediately revoke the old token. A suspected controller
credential does not require rotating device credentials.

The admin console can rotate an enrolled Agent credential without changing its
Agent ID. The new token is returned once; the prior hash is accepted for at most
24 hours so a remote phone can be updated without an outage. Revoke the prior
token immediately after the device is confirmed on the new credential. Rotation
of `primary` migrates it away from the hosted legacy `AGENT_TOKEN`; after the
grace window, the legacy value is no longer accepted for that Agent.

Never commit production tokens. GitHub CLI authentication should use its normal
credential store instead of `github_info.txt`.
