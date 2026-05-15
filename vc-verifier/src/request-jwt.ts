import { randomUUID } from 'node:crypto';
import { SignJWT, calculateJwkThumbprint, importJWK, type JWK, type JWTPayload } from 'jose';
import type { Oid4vpAuthRequest, VerifierConfig } from './types';

interface BuildRequestJwtInput {
  requestId: string;
  callbackUri: string;
  nonce: string;
  state: string;
  clientId: string;
  requestIssuer?: string;
  dcqlQuery: Oid4vpAuthRequest['dcql_query'];
  walletNonce?: string;
}

interface BuildRequestJwtOutput {
  jwt: string;
  payload: Oid4vpAuthRequest & {
    iss: string;
    iat: number;
    exp: number;
    jti: string;
  };
}

export function deriveRedirectUriClientId(callbackUri: string): string {
  return `redirect_uri:${callbackUri}`;
}

function defaultSigningAlg(jwk: JsonWebKey): string {
  if (jwk.alg) {
    return jwk.alg;
  }

  if (jwk.kty === 'OKP') {
    return 'EdDSA';
  }

  if (jwk.kty === 'RSA') {
    return 'RS256';
  }

  if (jwk.kty === 'EC') {
    if (jwk.crv === 'P-384') {
      return 'ES384';
    }
    if (jwk.crv === 'P-521') {
      return 'ES512';
    }
    return 'ES256';
  }

  return 'ES256';
}

export async function resolveSigningKid(config: VerifierConfig): Promise<string> {
  if (config.requestSigningKid) {
    return config.requestSigningKid;
  }

  const keyId = (config.requestSigningPrivateJwk as JWK).kid;
  if (keyId) {
    return keyId;
  }

  return calculateJwkThumbprint(config.requestSigningPrivateJwk as JWK);
}

export function resolveSigningAlg(config: VerifierConfig): string {
  return config.requestSigningAlg || defaultSigningAlg(config.requestSigningPrivateJwk);
}

export async function buildSignedRequestJwt(
  input: BuildRequestJwtInput,
  config: VerifierConfig
): Promise<BuildRequestJwtOutput> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + config.requestJwtTtlSeconds;
  const signingAlg = resolveSigningAlg(config);
  const kid = await resolveSigningKid(config);

  const payload: BuildRequestJwtOutput['payload'] = {
    iss: input.requestIssuer || config.verifierIssuer,
    response_type: 'vp_token',
    response_mode: 'direct_post',
    client_id: input.clientId,
    response_uri: input.callbackUri,
    redirect_uri: config.verifierRedirectUri,
    aud: config.requestAudience,
    nonce: input.nonce,
    state: input.state,
    iat: now,
    exp,
    jti: input.requestId || randomUUID(),
    dcql_query: input.dcqlQuery,
    client_metadata: {
      client_name: config.clientMetadata.clientName,
      logo_uri: config.clientMetadata.logoUri,
      redirect_uris: config.clientMetadata.redirectUris,
      policy_uri: config.clientMetadata.policyUri,
      client_uri: config.clientMetadata.clientUri,
      vp_formats: {},
      vp_formats_supported: config.clientMetadata.vpFormatsSupported
    }
  };
  if (input.walletNonce) {
    payload.wallet_nonce = input.walletNonce;
  }

  const key = await importJWK(config.requestSigningPrivateJwk as JWK, signingAlg);

  const jwt = await new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({
      typ: 'oauth-authz-req+jwt',
      alg: signingAlg,
      kid
    })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(payload.jti)
    .sign(key);

  return { jwt, payload };
}
