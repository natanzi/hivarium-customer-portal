# Customer portal authentication

The customer portal uses Hivarium first-party passwordless magic links. Cloudflare Access remains the operator-console boundary for ops.hivarium.dev; it is not the customer identity provider.

## Sign-in flow

1. An operator approves a demo or customer account.
2. Provisioning creates an active portal_memberships row for the approved work email.
3. The customer enters that email at /login.
4. The Worker always returns the same 202 response, whether or not the account exists.
5. For one active membership, the Worker sends a single-use link through Resend from access@hivarium.dev.
6. The email opens a confirmation page with the token in the URL fragment. The token is not sent to the server until the customer clicks Continue, so Outlook Safe Links and other email scanners cannot consume it.
7. The link expires after 10 minutes. Confirmation creates an HttpOnly, Secure, SameSite=Lax session cookie.
8. A portal session lasts at most 24 hours and never beyond the membership's demo expiration.

Challenge and session tokens are generated from 256 bits of randomness. Only SHA-256 hashes are stored in D1. New links supersede older pending links, successful links are single-use, and durable email/IP throttles limit abuse.

## Production configuration

Required portal Worker secret:

    EMAIL_PROVIDER_API_KEY

Required portal Worker variables:

    EMAIL_PROVIDER_URL=https://api.resend.com/emails
    EMAIL_FROM_ADDRESS=Hivarium Access <access@hivarium.dev>
    EMAIL_REPLY_TO=access@hivarium.dev
    PORTAL_BASE_URL=https://portal.hivarium.dev

The sender domain must be verified in Resend. The API key must never be committed.

## Cloudflare rollout

Deploy and test the new Worker plus migration before changing the edge policy. Then remove or disable the Cloudflare Access self-hosted application protecting portal.hivarium.dev; otherwise Access intercepts /login and /api/auth/* before the Worker can run. Do not change the Access application protecting ops.hivarium.dev.

Machine credentials and service-to-service bearer tokens remain unchanged.
