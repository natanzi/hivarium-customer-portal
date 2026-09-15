See the Operator Console copies of these documents for the full matrix. Portal-specific notes:

- Inbound: `PUT /service/v1/customers/:customerId/memberships/:email` with `OPERATOR_CALLER_TOKEN`.
- Membership is created only after Operator approval; unapproved applicants never appear as customers.
- `portal_memberships.demo_expires_at` is owned here.
- Access OTP authenticates email; membership authorizes the customer id. Never accept `customerId` from the browser.
- Welcome email may include `CUSTOMER_PORTAL_URL`. `AGENT_WORKSPACE_URL` is operator-owned configuration and is not stored in Portal D1.
