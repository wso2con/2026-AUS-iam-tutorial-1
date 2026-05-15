import { describe, expect, it } from 'vitest';
import { verifySdJwtPresentation } from '../src/sdjwt';
import { createSdJwtFixture } from './sdjwt-fixture';
import { baseVerifierConfig } from './test-config';

describe('verifySdJwtPresentation', () => {
  it('accepts a valid SD-JWT VC presentation with required claims', async () => {
    const fixture = await createSdJwtFixture();
    const config = baseVerifierConfig({
      trustedIssuerJwks: {
        [fixture.issuer]: { keys: [fixture.publicJwk as JsonWebKey] }
      }
    });

    const result = await verifySdJwtPresentation(
      {
        sdJwtPresentation: fixture.presentation,
        expectedNonce: 'nonce',
        expectedAudience: 'redirect_uri:https://verifier.example/openid4vp/authorization-response',
        requiredClaims: config.requiredClaims
      },
      config
    );

    expect(result.valid).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.claims?.given_name).toBe('Alice');
  });

  it('accepts undisclosed optional SD-JWT digests when required claims are disclosed', async () => {
    const fixture = await createSdJwtFixture({ undisclosedClaims: ['membership_number', 'lounge_tier'] });
    const config = baseVerifierConfig({
      trustedIssuerJwks: {
        [fixture.issuer]: { keys: [fixture.publicJwk as JsonWebKey] }
      }
    });

    const result = await verifySdJwtPresentation(
      {
        sdJwtPresentation: fixture.presentation,
        expectedNonce: 'nonce',
        expectedAudience: 'redirect_uri:https://verifier.example/openid4vp/authorization-response',
        requiredClaims: config.requiredClaims
      },
      config
    );

    expect(result.valid).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.claims?.given_name).toBe('Alice');
    expect(result.claims?.membership_number).toBeUndefined();
    expect(result.claims?.lounge_tier).toBeUndefined();
  });

  it('rejects invalid signature', async () => {
    const validFixture = await createSdJwtFixture();
    const tamperedFixture = await createSdJwtFixture({ tamperSignature: true, issuer: validFixture.issuer });

    const config = baseVerifierConfig({
      trustedIssuerJwks: {
        [validFixture.issuer]: { keys: [validFixture.publicJwk as JsonWebKey] }
      }
    });

    const result = await verifySdJwtPresentation(
      {
        sdJwtPresentation: tamperedFixture.presentation,
        expectedNonce: 'nonce',
        expectedAudience: 'redirect_uri:https://verifier.example/openid4vp/authorization-response',
        requiredClaims: config.requiredClaims
      },
      config
    );

    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/signature/i);
  });

  it('rejects when required disclosure is missing', async () => {
    const fixture = await createSdJwtFixture({ includeClaims: ['given_name', 'family_name'] });
    const config = baseVerifierConfig({
      trustedIssuerJwks: {
        [fixture.issuer]: { keys: [fixture.publicJwk as JsonWebKey] }
      }
    });

    const result = await verifySdJwtPresentation(
      {
        sdJwtPresentation: fixture.presentation,
        expectedNonce: 'nonce',
        expectedAudience: 'redirect_uri:https://verifier.example/openid4vp/authorization-response',
        requiredClaims: config.requiredClaims
      },
      config
    );

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('Missing required claim: birthdate');
  });
});
