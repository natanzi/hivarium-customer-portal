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

import type { LicenseState, LicenseRecord } from '../../shared/types';
import { FetchOperatorService, type UpstreamResult } from './operator';

export interface LicenseDocumentResult {
  body: ArrayBuffer;
  contentType: string | null;
  contentDisposition: string | null;
}

export interface LicensePort {
  getLicenses(customerId: string): Promise<UpstreamResult<LicenseState>>;
  getLicense(customerId: string, licenseId: string): Promise<UpstreamResult<LicenseRecord>>;
  downloadLicenseDocument(customerId: string, licenseId: string): Promise<UpstreamResult<LicenseDocumentResult>>;
}

export class FetchLicenseService implements LicensePort {
  private readonly fetcher: FetchOperatorService;
  private readonly token?: string;
  private readonly binding?: Fetcher;
  private readonly urlOverride?: string;

  constructor(private readonly deps: { binding?: Fetcher; urlOverride?: string; token?: string }) {
    this.binding = deps.binding;
    this.urlOverride = deps.urlOverride;
    this.token = deps.token;
    this.fetcher = new FetchOperatorService({
      binding: deps.binding,
      urlOverride: deps.urlOverride,
      token: deps.token,
    });
  }

  async getLicenses(customerId: string): Promise<UpstreamResult<LicenseState>> {
    const result = await this.fetcher.fetchLicenseState(
      `/service/v1/customers/${encodeURIComponent(customerId)}/licenses`,
    );
    if (result.ok) return result;
    if (result.error.code === 'missing_binding') {
      return { ok: false, error: { code: 'missing_binding', detail: 'License service binding is not configured.' } };
    }
    return { ok: false, error: { code: 'not_implemented', detail: 'License Service does not implement the license read endpoint yet.' } };
  }

  async getLicense(customerId: string, licenseId: string): Promise<UpstreamResult<LicenseRecord>> {
    const path = `/service/v1/customers/${encodeURIComponent(customerId)}/licenses/${encodeURIComponent(licenseId)}`;
    const requestUrl = this.binding
      ? `https://license-service${path}`
      : `${this.urlOverride}${path}`;
    try {
      const headers = new Headers();
      if (this.token) {
        headers.set('Authorization', `Bearer ${this.token}`);
      }
      const response = this.binding
        ? await this.binding.fetch(requestUrl, { headers })
        : await fetch(requestUrl, { headers });

      if (response.status === 404) return { ok: false, error: { code: 'not_implemented', detail: 'License not found' } };
      if (response.status === 401 || response.status === 403) return { ok: false, error: { code: 'unreachable', detail: 'upstream auth error' } };
      if (!response.ok) return { ok: false, error: { code: 'unreachable', detail: 'upstream error' } };

      const data = await response.json() as LicenseRecord;
      return { ok: true, value: data };
    } catch {
      return { ok: false, error: { code: 'unreachable', detail: 'upstream unreachable' } };
    }
  }

  async downloadLicenseDocument(customerId: string, licenseId: string): Promise<UpstreamResult<LicenseDocumentResult>> {
    if (!this.binding && !this.urlOverride) {
      return { ok: false, error: { code: 'missing_binding', detail: 'License service binding is not configured.' } };
    }
    const path = `/service/v1/customers/${encodeURIComponent(customerId)}/licenses/${encodeURIComponent(licenseId)}/document`;
    const requestUrl = this.binding
      ? `https://license-service${path}`
      : `${this.urlOverride}${path}`;
    try {
      const headers = new Headers();
      if (this.token) {
        headers.set('Authorization', `Bearer ${this.token}`);
      }
      const response = this.binding
        ? await this.binding.fetch(requestUrl, { headers })
        : await fetch(requestUrl, { headers });

      if (response.status === 404) return { ok: false, error: { code: 'not_implemented', detail: 'Document not found' } };
      if (response.status === 401 || response.status === 403) return { ok: false, error: { code: 'unreachable', detail: 'upstream auth error' } };
      if (!response.ok) return { ok: false, error: { code: 'unreachable', detail: 'upstream error' } };

      const body = await response.arrayBuffer();
      const contentType = response.headers.get('content-type');
      const contentDisposition = response.headers.get('content-disposition');
      return { ok: true, value: { body, contentType, contentDisposition } };
    } catch {
      return { ok: false, error: { code: 'unreachable', detail: 'upstream unreachable' } };
    }
  }
}