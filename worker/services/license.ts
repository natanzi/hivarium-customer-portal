/**
 * LicenseService port.
 *
 * The License Service is authoritative for signed license documents.
 * The portal reads the customer-authorized subset through
 * `/service/v1/customers/:customerId/licenses*` and never exposes signing
 * secrets, internal license payload secrets, or operator-only notes.
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
    return this.fetcher.fetchLicenseState(
      `/service/v1/customers/${encodeURIComponent(customerId)}/licenses`,
    );
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

      const payload = await response.json() as { data?: LicenseRecord } & LicenseRecord;
      const record = payload.data ?? payload;
      const mapped = {
        id: (record as { id?: string; licenseId?: string }).id ?? (record as { licenseId?: string }).licenseId ?? '',
        licenseType: (record as { licenseType?: string }).licenseType ?? 'license',
        status: (record as LicenseRecord).status,
        issuedAt: (record as LicenseRecord).issuedAt ?? (record as { validFrom?: string }).validFrom ?? '',
        expiresAt: (record as LicenseRecord).expiresAt ?? (record as { validUntil?: string }).validUntil ?? '',
        product: (record as LicenseRecord).product ?? (record as { productId?: string }).productId,
        revision: (record as LicenseRecord).revision,
        permittedAgentProducts: (record as LicenseRecord).permittedAgentProducts ?? [],
        deployments: (record as LicenseRecord).deployments ?? [],
      };
      return { ok: true, value: mapped };
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