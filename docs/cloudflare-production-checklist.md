# Cloudflare production checklist (Customer Portal)

Preferred MVP: Cloudflare Access email OTP for `portal.hivarium.dev`. Portal membership remains the only source of `customerId`.

Do not store a broad Cloudflare API token or mutate Access policies from this Worker.

See also `hivarium-operator-console/docs/cloudflare-production-checklist.md`.
