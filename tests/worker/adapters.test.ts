import { describe, it, expect, vi } from 'vitest';
import { FetchOperatorService } from '../../worker/services/operator';
import { FetchLicenseService } from '../../worker/services/license';

describe('FetchOperatorService', () => {
  it('handles valid upstream responses', async () => {
    const fetchArgs: any[] = [];
    const binding = {
      fetch: async (url: string, init: any) => {
        fetchArgs.push({ url, init }); return new Response(JSON.stringify({
          organization: { customerId: 'cust-123' }
        }));
      }
    } as any;

    const op = new FetchOperatorService({ binding, token: 'op-token' });
    const res = await op.getPortalView('cust-123');

    expect(res.ok).toBe(true);
    expect((res as any).value.organization.customerId).toBe('cust-123');
    expect(fetchArgs[0].url).toBe('https://operator-service/service/v1/customers/cust-123/portal-view');
    expect(fetchArgs[0].init.headers.get('Authorization')).toBe('Bearer op-token');
  });

  it('fails on missing binding', async () => {
    const op = new FetchOperatorService({});
    const res = await op.getPortalView('cust-123');
    expect(res.ok).toBe(false);
    expect((res as any).error.code).toBe('missing_binding');
  });

  it('fails on missing token but does not crash', async () => {
    const fetchArgs: any[] = [];
    const binding = { fetch: async (url: string, init: any) => { fetchArgs.push({ url, init }); return new Response('{}'); } } as any;
    const op = new FetchOperatorService({ binding });
    const res = await op.getPortalView('cust-123');
    expect(res.ok).toBe(false); // will fail due to validation
    expect(fetchArgs[0].init.headers.get('Authorization')).toBeFalsy();
  });

  it('handles malformed responses without silent fallback', async () => {
    const binding = { fetch: async () => new Response('{"not":"quite"}') } as any;
    const op = new FetchOperatorService({ binding, token: 'op-token' });
    const res = await op.getPortalView('cust-123');
    expect(res.ok).toBe(false);
    expect((res as any).error.code).toBe('unreachable');
  });

  it('handles 401/403/404/500', async () => {
    const binding401 = { fetch: async () => new Response('', { status: 401 }) } as any;
    const op401 = new FetchOperatorService({ binding: binding401, token: 'op-token' });
    expect((await op401.getPortalView('cust-123')).ok).toBe(false);

    const binding404 = { fetch: async () => new Response('', { status: 404 }) } as any;
    const op404 = new FetchOperatorService({ binding: binding404, token: 'op-token' });
    expect((await op404.getPortalView('cust-123') as any).error.code).toBe('not_implemented');

    const binding500 = { fetch: async () => new Response('', { status: 500 }) } as any;
    const op500 = new FetchOperatorService({ binding: binding500, token: 'op-token' });
    expect((await op500.getPortalView('cust-123') as any).error.code).toBe('unreachable');
  });
});

describe('FetchLicenseService', () => {
  it('handles signature download with exact document URL, authentication, and binary payload preservation', async () => {
    const fetchArgs: any[] = [];
    const encoder = new TextEncoder();
    const mockBuffer = encoder.encode('signedblob').buffer;

    const binding = {
      fetch: async (u: string, init: any) => {
        fetchArgs.push({ url: u, init });

        const response = new Response(mockBuffer, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="lic.pdf"'
          }
        });
        return response;
      }
    } as any;

    const ls = new FetchLicenseService({ binding, token: 'lic-token' });
    const res = await ls.downloadLicenseDocument('cust-99', 'lic-1');

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('not ok');

    // binary/signed payload preserved
    expect(new Uint8Array(res.value.body)).toEqual(new Uint8Array(mockBuffer));
    // response headers preserved
    expect(res.value.contentType).toBe('application/pdf');
    expect(res.value.contentDisposition).toBe('attachment; filename="lic.pdf"');

    // exact document URL and encoded customerId/licenseId
    expect(fetchArgs[0].url).toBe('https://license-service/service/v1/customers/cust-99/licenses/lic-1/document');
    // correct bearer token
    expect(fetchArgs[0].init.headers.get('Authorization')).toBe('Bearer lic-token');
  });

  it('handles upstream 404 with no fallback data', async () => {
    const binding = { fetch: async () => new Response('{}', { status: 404 }) } as any;
    const ls = new FetchLicenseService({ binding, token: 'lic-token' });
    const res = await ls.downloadLicenseDocument('foo', 'bar');
    expect(res.ok).toBe(false);
    expect((res as any).error.code).toBe('not_implemented');
  });

  it('handles upstream authentication failure with no fallback data', async () => {
    const binding = { fetch: async () => new Response('{}', { status: 401 }) } as any;
    const ls = new FetchLicenseService({ binding, token: 'bad-token' });
    const res = await ls.downloadLicenseDocument('foo', 'bar');
    expect(res.ok).toBe(false);
    expect((res as any).error.code).toBe('unreachable');
  });

  it('handles upstream 500 error', async () => {
    const binding = { fetch: async () => new Response('{}', { status: 500 }) } as any;
    const ls = new FetchLicenseService({ binding, token: 'lic-token' });
    const res = await ls.downloadLicenseDocument('foo', 'bar');
    expect(res.ok).toBe(false);
    expect((res as any).error.code).toBe('unreachable');
  });
});
