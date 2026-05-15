import { decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import { buildDcqlQueryFromConfig } from '../src/oid4vp';
import { buildSignedRequestJwt, deriveRedirectUriClientId } from '../src/request-jwt';
import { baseVerifierConfig } from './test-config';

describe('request JWT builder', () => {
  it('derives redirect_uri client id from callback URL', () => {
    expect(deriveRedirectUriClientId('https://verifier.example/openid4vp/authorization-response')).toBe(
      'redirect_uri:https://verifier.example/openid4vp/authorization-response'
    );
  });

  it('creates signed request JWT with required OID4VP + DCQL claims', async () => {
    const config = baseVerifierConfig();
    const callbackUri = 'https://verifier.example/openid4vp/authorization-response';
    const clientId = deriveRedirectUriClientId(callbackUri);

    const { jwt, payload } = await buildSignedRequestJwt(
      {
        requestId: 'req-123',
        callbackUri,
        nonce: 'nonce-123',
        state: 'state-456',
        clientId,
        dcqlQuery: buildDcqlQueryFromConfig(config.requestDcql)
      },
      config
    );

    const header = decodeProtectedHeader(jwt);
    const decodedPayload = decodeJwt(jwt);

    expect(header.typ).toBe('oauth-authz-req+jwt');
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe('verifier-demo-kid');

    expect(decodedPayload.iss).toBe(config.verifierIssuer);
    expect(decodedPayload.client_id).toBe(clientId);
    expect(decodedPayload.aud).toBe('https://self-issued.me/v2');
    expect(decodedPayload.redirect_uri).toBe(config.verifierRedirectUri);
    expect(decodedPayload.response_type).toBe('vp_token');
    expect(decodedPayload.response_mode).toBe('direct_post');
    expect(decodedPayload.response_uri).toBe(callbackUri);
    expect(decodedPayload.nonce).toBe('nonce-123');
    expect(decodedPayload.state).toBe('state-456');
    expect(decodedPayload.jti).toBe('req-123');
    expect(decodedPayload.exp).toBeTypeOf('number');
    expect(decodedPayload.iat).toBeTypeOf('number');

    const dcql = decodedPayload.dcql_query as { credentials: Array<{ format: string; meta?: { vct_values: string[] } }> };
    expect(dcql.credentials[0].format).toBe('dc+sd-jwt');
    expect(dcql.credentials[0].meta?.vct_values).toEqual(['https://pidissuer.demo.connector.lissi.io/pid']);

    const metadata = decodedPayload.client_metadata as {
      client_name: string;
      logo_uri?: string;
      redirect_uris: string[];
      vp_formats: Record<string, unknown>;
      vp_formats_supported: Record<string, unknown>;
    };
    expect(metadata.client_name).toBe('Partner Bank');
    expect(metadata.logo_uri).toBe('https://ux-backend-demo.lissi.io/images/partnerbankLogo.png');
    expect(metadata.redirect_uris).toEqual(['https://www.lissi.id/demo-bank-select-service-partner?firstName=&lastName=']);
    expect(metadata.vp_formats).toEqual({});
    expect(metadata.vp_formats_supported['dc+sd-jwt']).toBeDefined();
    expect(payload.client_metadata.client_name).toBe('Partner Bank');
  });
});
