import type { VerifierConfig } from '../src/types';

export const testRequestSigningJwk: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'tjfm-1mQPGNPFMT9EXN5C0-JKjnkW9AfYeq7X1d0xi0',
  y: '0OLzpn1QC3p_dwccDX3mY4pnxRZ6u7etNq5dGXdu4pc',
  d: 'H8kFstvct5rgaloz6RHdM_5hNa3mIpEzJH2pqPqmjUM'
};

export function baseVerifierConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    port: 3001,
    appBaseUrl: 'https://verifier.example',
    sessionTtlSeconds: 300,
    requiredClaims: ['given_name', 'family_name', 'birthdate'],
    verifierIssuer: 'https://verifier.example',
    verifierRedirectUri: 'https://www.lissi.id/demo-bank-select-service-partner?firstName=&lastName=',
    requestAudience: 'https://self-issued.me/v2',
    clientMetadata: {
      clientName: 'Partner Bank',
      logoUri: 'https://ux-backend-demo.lissi.io/images/partnerbankLogo.png',
      redirectUris: ['https://www.lissi.id/demo-bank-select-service-partner?firstName=&lastName='],
      policyUri: 'https://docs.lissi.id/legal/lissi-id-wallet-datenschutzhinweise-privacy-policy',
      clientUri: 'https://lissi.id',
      vpFormatsSupported: {
        'dc+sd-jwt': {
          'sd-jwt_alg_values': ['ES256'],
          'kb-jwt_alg_values': ['ES256'],
          'alg_values': ['ES256']
        }
      }
    },
    requestDcql: {
      credentialId: 'sd-jwt-pid',
      vctValues: ['https://pidissuer.demo.connector.lissi.io/pid'],
      claims: [
        { id: 'given_name', path: ['given_name'] },
        { id: 'family_name', path: ['family_name'] },
        { id: 'birthdate', path: ['birthdate'] },
        { id: 'address-street_address', path: ['address', 'street_address'] },
        { id: 'address-locality', path: ['address', 'locality'] },
        { id: 'address-postal_code', path: ['address', 'postal_code'] },
        { id: 'address-country', path: ['address', 'country'] }
      ]
    },
    allowRemoteJwks: false,
    trustedIssuerJwks: {},
    requestJwtTtlSeconds: 300,
    requestSigningPrivateJwk: testRequestSigningJwk,
    requestSigningKid: 'verifier-demo-kid',
    requestSigningAlg: 'ES256',
    logRawVpToken: false,
    ...overrides
  };
}
