/**
 * LicenseService port.
 *
 * The License Service is authoritative for signed license documents,
 * activations, expirations and revocations. The portal reads only the
 * customer-authorized subset through this port and never exposes signing
 * secrets, internal license payload secrets, or operator-only notes.
 *
 * The License Service does not yet expose any license read endpoint (only
 * `/health` exists), so every method currently fails closed with
 * `not_implemented` when the binding exists, or `missing_binding` when it
 * does not. See docs/internal-service-contracts.md for the expected contract.
 */

import type { LicenseState } from '../../shared/types';
import { FetchOperatorService, type UpstreamResult } from './operator';

export interface LicensePort {
  getLicenses(customerId: string): Promise<UpstreamResult<LicenseState>>;
}

export class FetchLicenseService implements LicensePort {
  private readonly fetcher: FetchOperatorService;

  constructor(private readonly deps: { binding?: Fetcher; urlOverride?: string }) {
    this.fetcher = new FetchOperatorService({
      binding: deps.binding,
      urlOverride: deps.urlOverride,
    });
  }

  async getLicenses(customerId: string): Promise<UpstreamResult<LicenseState>> {
    // The License Service currently exposes no license read endpoint.
    // Expected contract documented in docs/internal-service-contracts.md:
    // GET /api/v1/licenses?customerId=...  ->  { licenses: [...] }
    const result = await this.fetcher.fetchLicenseState(
      `/api/v1/licenses?customerId=${encodeURIComponent(customerId)}`,
    );
    if (result.ok) return result;
    if (result.error.code === 'missing_binding') {
      return { ok: false, error: { code: 'missing_binding', detail: 'License service binding is not configured.' } };
    }
    // A 404 upstream means the endpoint is not implemented yet: the portal
    // must show the license section as unavailable rather than fabricate data.
    return { ok: false, error: { code: 'not_implemented', detail: 'License Service does not implement the license read endpoint yet.' } };
  }
}