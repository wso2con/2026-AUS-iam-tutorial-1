import { describe, expect, it } from 'vitest';
import { buildRequestUri, buildCallbackUri, buildLissiRequestUriDeepLink } from '../src/oid4vp';
import { deriveRedirectUriClientId } from '../src/request-jwt';

describe('OID4VP request URI helpers', () => {
  it('builds Lissi-compatible wallet link with redirect_uri client_id and request_uri_method=post', () => {
    const baseUrl = 'https://verifier.example';
    const requestUri = buildRequestUri('req-1', baseUrl);
    const callbackUri = buildCallbackUri(baseUrl);
    const clientId = deriveRedirectUriClientId(callbackUri);

    expect(requestUri).toBe('https://verifier.example/openid4vp/authorization-request/req-1');
    expect(callbackUri).toBe('https://verifier.example/openid4vp/authorization-response');

    const walletLink = buildLissiRequestUriDeepLink(requestUri, clientId);
    expect(walletLink).toContain('openid4vp://?');
    expect(walletLink).toContain(`client_id=${encodeURIComponent(clientId)}`);
    expect(walletLink).toContain(`request_uri=${encodeURIComponent(requestUri)}`);
    expect(walletLink).toContain('request_uri_method=post');
  });
});
