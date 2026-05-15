import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '../src/session-store';
import {
  createVerificationSession,
  getRequestObjectJwt,
  getRequestStatus,
  handleWalletResponse,
  type VerifierRuntime
} from '../src/verifier-runtime';
import { createSdJwtFixture } from './sdjwt-fixture';
import { baseVerifierConfig } from './test-config';

function createRuntime(overrides = {}): VerifierRuntime {
  const config = baseVerifierConfig(overrides);
  return {
    config,
    store: new SessionStore(config.sessionTtlSeconds)
  };
}

describe('OID4VP verifier API runtime', () => {
  it('rejects per-request issuer and DCQL overrides so claims come only from config', async () => {
    const runtime = createRuntime();

    const rejected = await createVerificationSession(
      {
        issuer: 'https://custom.verifier.example',
        dcql: {
          credentialId: 'custom-cred-id',
          vctValues: ['https://issuer.example/custom-vct'],
          claims: [
            { id: 'email', path: ['email'] },
            { id: 'address-country', path: ['address', 'country'] }
          ]
        }
      },
      runtime
    );
    expect(rejected.status).toBe(400);

    const created = await createVerificationSession({}, runtime);
    expect(created.status).toBe(201);
    const body = created.body as {
      requestObject: {
        iss: string;
        dcql_query: {
          credentials: Array<{
            id: string;
            meta?: { vct_values: string[] };
            claims: Array<{ id: string; path: string[] }>;
          }>;
        };
      };
    };

    expect(body.requestObject.iss).toBe('https://verifier.example');
    expect(body.requestObject.dcql_query.credentials[0].id).toBe('sd-jwt-pid');
    expect(body.requestObject.dcql_query.credentials[0].meta?.vct_values).toEqual([
      'https://pidissuer.demo.connector.lissi.io/pid'
    ]);
    expect(body.requestObject.dcql_query.credentials[0].claims).toEqual([
      { id: 'given_name', path: ['given_name'] },
      { id: 'family_name', path: ['family_name'] },
      { id: 'birthdate', path: ['birthdate'] },
      { id: 'address-street_address', path: ['address', 'street_address'] },
      { id: 'address-locality', path: ['address', 'locality'] },
      { id: 'address-postal_code', path: ['address', 'postal_code'] },
      { id: 'address-country', path: ['address', 'country'] }
    ]);
  });

  it('creates request, serves signed request JWT, processes callback, and updates status', async () => {
    const fixture = await createSdJwtFixture();
    const runtime = createRuntime({
      trustedIssuerJwks: {
        [fixture.issuer]: { keys: [fixture.publicJwk as JsonWebKey] }
      }
    });

    const created = await createVerificationSession({}, runtime);
    expect(created.status).toBe(201);
    const createBody = created.body as unknown as {
      requestObject: {
        response_mode: string;
        iss: string;
        aud: string;
        redirect_uri: string;
        dcql_query: { credentials: Array<{ meta?: { vct_values: string[] } }> };
        client_metadata: { vp_formats_supported: Record<string, unknown> };
      };
      walletLink: string;
      session: { id: string; state: string; clientId: string };
    };

    expect(createBody.requestObject.response_mode).toBe('direct_post');
    expect(createBody.requestObject.iss).toBe('https://verifier.example');
    expect(createBody.requestObject.aud).toBe('https://self-issued.me/v2');
    expect(createBody.requestObject.redirect_uri).toBe(
      'https://www.lissi.id/demo-bank-select-service-partner?firstName=&lastName='
    );
    expect(createBody.requestObject.dcql_query.credentials[0].meta?.vct_values).toEqual([
      'https://pidissuer.demo.connector.lissi.io/pid'
    ]);
    expect(createBody.requestObject.client_metadata.vp_formats_supported['dc+sd-jwt']).toBeDefined();
    expect(createBody.walletLink).toContain('openid4vp://?');
    expect(createBody.walletLink).toContain('request_uri_method=post');
    expect(createBody.session.clientId).toMatch(/^redirect_uri:/);

    const requestObject = await getRequestObjectJwt(createBody.session.id, 'GET', '', {}, runtime);
    expect(requestObject.status).toBe(200);
    expect('jwt' in requestObject && requestObject.jwt ? requestObject.jwt.split('.').length : 0).toBe(3);

    const requestObjectPost = await getRequestObjectJwt(
      createBody.session.id,
      'POST',
      'application/x-www-form-urlencoded',
      { wallet_nonce: 'wallet-nonce-1' },
      runtime
    );
    expect(requestObjectPost.status).toBe(200);
    const postPayload = decodeJwt('jwt' in requestObjectPost && requestObjectPost.jwt ? requestObjectPost.jwt : '');
    expect(postPayload.wallet_nonce).toBe('wallet-nonce-1');

    const response = await handleWalletResponse(
      {
        state: createBody.session.state,
        vp_token: fixture.presentation,
        presentation_submission: {
          id: 'submission-1',
          definition_id: 'pd-1',
          descriptor_map: [{ id: 'identity-sd-jwt', format: 'vc+sd-jwt', path: '$' }]
        }
      },
      'application/json',
      runtime
    );
    expect(response.status).toBe(200);

    const status = getRequestStatus(createBody.session.id, runtime);
    expect(status.status).toBe(200);
    expect((status.body as { status: string }).status).toBe('VERIFIED');
  });

  it('rejects wrong state and replay callbacks', async () => {
    const fixture = await createSdJwtFixture();
    const runtime = createRuntime({
      trustedIssuerJwks: {
        [fixture.issuer]: { keys: [fixture.publicJwk as JsonWebKey] }
      }
    });

    const created = await createVerificationSession({}, runtime);
    const createBody = created.body as { session: { state: string } };

    const wrongState = await handleWalletResponse(
      { state: 'wrong-state', vp_token: fixture.presentation },
      'application/json',
      runtime
    );
    expect(wrongState.status).toBe(400);

    const accepted = await handleWalletResponse(
      { state: createBody.session.state, vp_token: fixture.presentation },
      'application/json',
      runtime
    );
    expect(accepted.status).toBe(200);

    const replay = await handleWalletResponse(
      { state: createBody.session.state, vp_token: fixture.presentation },
      'application/json',
      runtime
    );
    expect(replay.status).toBe(409);
  });

  it('rejects unsupported callback content type and malformed vp_token', async () => {
    const fixture = await createSdJwtFixture();
    const runtime = createRuntime({
      trustedIssuerJwks: {
        [fixture.issuer]: { keys: [fixture.publicJwk as JsonWebKey] }
      }
    });

    const created = await createVerificationSession({}, runtime);
    const createBody = created.body as { session: { id: string; state: string } };

    const unsupported = await handleWalletResponse(
      { state: createBody.session.state, vp_token: fixture.presentation },
      'text/plain',
      runtime
    );
    expect(unsupported.status).toBe(415);

    const malformed = await handleWalletResponse(
      { state: createBody.session.state, vp_token: 'malformed_token' },
      'application/json',
      runtime
    );
    expect(malformed.status).toBe(200);

    const status = getRequestStatus(createBody.session.id, runtime);
    expect(status.status).toBe(200);
    expect((status.body as { status: string }).status).toBe('FAILED');
  });
});
