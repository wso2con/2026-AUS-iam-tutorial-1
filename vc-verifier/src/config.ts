import dotenv from 'dotenv';
import { z } from 'zod';
import type { JsonWebKeySet, VerifierConfig } from './types';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  REQUEST_JWT_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  VERIFIER_ISSUER: z.string().url().optional(),
  VERIFIER_REDIRECT_URI: z.string().url().optional(),
  REQUEST_AUDIENCE: z.string().default('https://self-issued.me/v2'),
  VERIFIER_CLIENT_NAME: z.string().default('Partner Bank'),
  VERIFIER_LOGO_URI: z.string().url().optional(),
  VERIFIER_POLICY_URI: z.string().url().optional(),
  VERIFIER_CLIENT_URI: z.string().url().optional(),
  VERIFIER_REDIRECT_URIS: z.string().optional(),
  REQUEST_DCQL_CREDENTIAL_ID: z.string().default('sd-jwt-pid'),
  REQUEST_DCQL_VCT_VALUES: z.string().default(''),
  REQUEST_DCQL_CLAIMS: z.string().min(1),
  REQUIRED_CLAIMS: z.string().default('given_name,family_name,birthdate'),
  ALLOW_REMOTE_JWKS: z
    .string()
    .default('true')
    .transform((value) => value.toLowerCase() !== 'false'),
  TRUSTED_ISSUER_JWKS: z.string().default('{}'),
  REQUEST_SIGNING_PRIVATE_JWK: z.string().min(1),
  REQUEST_SIGNING_KID: z.string().optional(),
  REQUEST_SIGNING_ALG: z.string().optional(),
  LOG_RAW_VP_TOKEN: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() === 'true')
});

function parseTrustedIssuerJwks(raw: string): Record<string, JsonWebKeySet> {
  try {
    const parsed = JSON.parse(raw) as Record<string, JsonWebKeySet>;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function parsePrivateJwk(raw: string): JsonWebKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('REQUEST_SIGNING_PRIVATE_JWK must be valid JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('REQUEST_SIGNING_PRIVATE_JWK must be a JSON object');
  }

  const jwk = parsed as JsonWebKey;
  if (!jwk.kty) {
    throw new Error('REQUEST_SIGNING_PRIVATE_JWK is missing kty');
  }

  const hasPrivateMaterial = Boolean(
    (jwk.kty === 'EC' && jwk.d) ||
      (jwk.kty === 'OKP' && jwk.d) ||
      (jwk.kty === 'RSA' && jwk.d)
  );

  if (!hasPrivateMaterial) {
    throw new Error('REQUEST_SIGNING_PRIVATE_JWK must include private key material (d)');
  }

  return jwk;
}

function parseStringList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseDcqlClaims(raw: string): Array<{ id: string; path: string[] }> {
  try {
    const parsed = JSON.parse(raw) as Array<{ id: string; path: string[] }>;
    if (!Array.isArray(parsed)) {
      throw new Error('REQUEST_DCQL_CLAIMS must be a JSON array');
    }

    const valid = parsed.filter(
      (claim) =>
        claim &&
        typeof claim.id === 'string' &&
        Array.isArray(claim.path) &&
        claim.path.every((part) => typeof part === 'string')
    );
    if (valid.length !== parsed.length || valid.length === 0) {
      throw new Error('REQUEST_DCQL_CLAIMS must contain at least one valid {id,path} claim');
    }

    return valid;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('REQUEST_DCQL_CLAIMS')) {
      throw error;
    }
    throw new Error('REQUEST_DCQL_CLAIMS must be valid JSON');
  }
}

export function loadConfig(): VerifierConfig {
  const env = envSchema.parse(process.env);
  const callbackUri = `${env.APP_BASE_URL.replace(/\/+$/, '')}/openid4vp/authorization-response`;
  const verifierRedirectUri = env.VERIFIER_REDIRECT_URI || callbackUri;
  const verifierRedirectUris = parseStringList(env.VERIFIER_REDIRECT_URIS);
  const vctValues = parseStringList(env.REQUEST_DCQL_VCT_VALUES);

  return {
    port: env.PORT,
    appBaseUrl: env.APP_BASE_URL.replace(/\/+$/, ''),
    sessionTtlSeconds: env.SESSION_TTL_SECONDS,
    requiredClaims: env.REQUIRED_CLAIMS.split(',').map((claim) => claim.trim()).filter(Boolean),
    verifierIssuer: env.VERIFIER_ISSUER || env.APP_BASE_URL.replace(/\/+$/, ''),
    verifierRedirectUri,
    requestAudience: env.REQUEST_AUDIENCE,
    clientMetadata: {
      clientName: env.VERIFIER_CLIENT_NAME,
      logoUri: env.VERIFIER_LOGO_URI,
      redirectUris: verifierRedirectUris.length > 0 ? verifierRedirectUris : [verifierRedirectUri],
      policyUri: env.VERIFIER_POLICY_URI,
      clientUri: env.VERIFIER_CLIENT_URI,
      vpFormatsSupported: {
        'dc+sd-jwt': {
          'sd-jwt_alg_values': ['ES256'],
          'kb-jwt_alg_values': ['ES256'],
          'alg_values': ['ES256']
        }
      }
    },
    requestDcql: {
      credentialId: env.REQUEST_DCQL_CREDENTIAL_ID,
      vctValues,
      claims: parseDcqlClaims(env.REQUEST_DCQL_CLAIMS)
    },
    allowRemoteJwks: env.ALLOW_REMOTE_JWKS,
    trustedIssuerJwks: parseTrustedIssuerJwks(env.TRUSTED_ISSUER_JWKS),
    requestJwtTtlSeconds: env.REQUEST_JWT_TTL_SECONDS,
    requestSigningPrivateJwk: parsePrivateJwk(env.REQUEST_SIGNING_PRIVATE_JWK),
    requestSigningKid: env.REQUEST_SIGNING_KID,
    requestSigningAlg: env.REQUEST_SIGNING_ALG,
    logRawVpToken: env.LOG_RAW_VP_TOKEN
  };
}
