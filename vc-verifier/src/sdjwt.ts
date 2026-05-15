import { createHash } from 'node:crypto';
import {
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload
} from 'jose';
import type { JsonWebKeySet, VerifySdJwtInput, VerifySdJwtOutput, VerifierConfig } from './types';

type DisclosureEntry = {
  encoded: string;
  key?: string;
  value: unknown;
};

type DisclosureMap = Map<string, DisclosureEntry>;
const undisclosedArrayElement = Symbol('undisclosedArrayElement');

function base64UrlDecodeToString(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function hashDisclosure(encodedDisclosure: string, alg: string): string {
  const hashAlg = alg.toLowerCase() === 'sha-512' ? 'sha512' : 'sha256';
  const digest = createHash(hashAlg).update(encodedDisclosure).digest('base64url');
  return digest;
}

function decodeDisclosures(disclosures: string[]): DisclosureMap {
  const map: DisclosureMap = new Map();

  for (const encoded of disclosures) {
    const parsed = JSON.parse(base64UrlDecodeToString(encoded)) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 2) {
      continue;
    }

    if (parsed.length >= 3 && typeof parsed[1] === 'string') {
      map.set(encoded, {
        encoded,
        key: parsed[1],
        value: parsed[2]
      });
    } else {
      map.set(encoded, {
        encoded,
        value: parsed[1]
      });
    }
  }

  return map;
}

function applyDisclosuresRecursively(
  node: unknown,
  disclosureLookup: Map<string, DisclosureEntry>,
  disclosedDigestsUsed: Set<string>,
  reasons: string[]
): unknown {
  if (Array.isArray(node)) {
    return node
      .map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item) && '...' in item) {
          const digest = (item as Record<string, unknown>)['...'];
          if (typeof digest === 'string') {
            const disclosure = disclosureLookup.get(digest);
            if (!disclosure) {
              return undisclosedArrayElement;
            }
            disclosedDigestsUsed.add(digest);
            return disclosure.value;
          }
        }
        return applyDisclosuresRecursively(item, disclosureLookup, disclosedDigestsUsed, reasons);
      })
      .filter((item) => item !== undisclosedArrayElement);
  }

  if (!node || typeof node !== 'object') {
    return node;
  }

  const obj = { ...(node as Record<string, unknown>) };
  const sdDigests = Array.isArray(obj._sd) ? (obj._sd as unknown[]) : [];

  for (const digestCandidate of sdDigests) {
    if (typeof digestCandidate !== 'string') {
      continue;
    }

    const disclosure = disclosureLookup.get(digestCandidate);
    if (!disclosure) {
      continue;
    }

    if (!disclosure.key) {
      reasons.push(`Disclosure for digest ${digestCandidate} does not contain a claim key`);
      continue;
    }

    disclosedDigestsUsed.add(digestCandidate);
    obj[disclosure.key] = applyDisclosuresRecursively(
      disclosure.value,
      disclosureLookup,
      disclosedDigestsUsed,
      reasons
    );
  }

  delete obj._sd;
  delete obj._sd_alg;

  for (const [key, value] of Object.entries(obj)) {
    obj[key] = applyDisclosuresRecursively(value, disclosureLookup, disclosedDigestsUsed, reasons);
  }

  return obj;
}

async function resolveIssuerJwks(issuer: string, config: VerifierConfig): Promise<JsonWebKeySet | undefined> {
  if (config.trustedIssuerJwks[issuer]) {
    return config.trustedIssuerJwks[issuer];
  }

  if (!config.allowRemoteJwks || !issuer.startsWith('https://')) {
    return undefined;
  }

  const wellKnownIssuer = `${issuer.replace(/\/+$/, '')}/.well-known/openid-credential-issuer`;
  try {
    const issuerResponse = await fetch(wellKnownIssuer);
    if (issuerResponse.ok) {
      const issuerMetadata = (await issuerResponse.json()) as { jwks_uri?: string };
      if (issuerMetadata.jwks_uri) {
        const jwksResponse = await fetch(issuerMetadata.jwks_uri);
        if (jwksResponse.ok) {
          return (await jwksResponse.json()) as JsonWebKeySet;
        }
      }
    }
  } catch {
    // Continue to fallback.
  }

  const fallback = `${issuer.replace(/\/+$/, '')}/.well-known/jwks.json`;
  try {
    const fallbackResponse = await fetch(fallback);
    if (fallbackResponse.ok) {
      return (await fallbackResponse.json()) as JsonWebKeySet;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function verifyWithJwks(
  jwt: string,
  jwks: JsonWebKeySet,
  issuer: string
): Promise<{ payload: JWTPayload; protectedHeader: Record<string, unknown> }> {
  const getKey = async (
    protectedHeader: Record<string, unknown>
  ): Promise<CryptoKey | Uint8Array> => {
    const kid = protectedHeader.kid;
    const alg = protectedHeader.alg;

    const candidates =
      typeof kid === 'string'
        ? jwks.keys.filter((key) => (key as JWK).kid === kid)
        : jwks.keys;

    if (candidates.length === 0) {
      throw new Error('No matching issuer key found for token kid');
    }

    const selectedKey = candidates[0] as JWK;
    return importJWK(selectedKey, typeof alg === 'string' ? alg : undefined);
  };

  const result = await jwtVerify(jwt, getKey, { issuer });
  return {
    payload: result.payload,
    protectedHeader: result.protectedHeader as Record<string, unknown>
  };
}

function extractPresentedSdJwt(vpToken: string | string[]): string {
  const tokenCandidate = Array.isArray(vpToken) ? vpToken[0] : vpToken;
  if (Array.isArray(vpToken)) {
    if (vpToken.length === 0 || typeof tokenCandidate !== 'string') {
      throw new Error('vp_token array is empty');
    }
  }

  let normalized = tokenCandidate.trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized;
}

function normalizeSdJwtPresentation(raw: string): string {
  let value = raw.trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  // x-www-form-urlencoded decoders may convert '+' to space.
  // If token contains spaces and JWT delimiters, treat spaces as lost pluses.
  if (value.includes(' ') && value.includes('.')) {
    value = value.replace(/ /g, '+');
  }

  // Some wallet transports accidentally include line breaks or tab characters.
  value = value.replace(/[\r\n\t]+/g, '');

  // If token arrived URL-encoded, decode once.
  if (/%[0-9A-Fa-f]{2}/.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep original if decode fails
    }
  }

  return canonicalizeSdJwtEncoding(value);
}

function canonicalizeBase64ToBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function canonicalizeJwtCompact(jwt: string): string {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    return jwt;
  }

  return parts.map((part) => canonicalizeBase64ToBase64Url(part)).join('.');
}

function canonicalizeSdJwtEncoding(value: string): string {
  const parts = value
    .split('~')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return value;
  }

  const normalizedParts = parts.map((part) => {
    if (part.includes('.')) {
      return canonicalizeJwtCompact(part);
    }

    return canonicalizeBase64ToBase64Url(part);
  });

  return normalizedParts.join('~');
}

export async function verifySdJwtPresentation(
  input: VerifySdJwtInput,
  config: VerifierConfig
): Promise<VerifySdJwtOutput> {
  const reasons: string[] = [];

  try {
    const normalizedPresentation = normalizeSdJwtPresentation(input.sdJwtPresentation);
    const segments = normalizedPresentation
      .split('~')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length === 0) {
      return { valid: false, reasons: ['Empty SD-JWT presentation'] };
    }

    const issuerJwt = segments[0];
    const maybeKbJwt = segments.length > 1 && segments[segments.length - 1].includes('.') ? segments[segments.length - 1] : undefined;
    const disclosureSegments = maybeKbJwt ? segments.slice(1, -1) : segments.slice(1);

    try {
      decodeProtectedHeader(issuerJwt);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown issuer JWT header parse failure';
      return {
        valid: false,
        reasons: [`Issuer SD-JWT protected header invalid: ${message}`]
      };
    }

    const unverifiedPayload = decodeJwt(issuerJwt);
    const issuer = typeof unverifiedPayload.iss === 'string' ? unverifiedPayload.iss : undefined;
    if (!issuer) {
      return { valid: false, reasons: ['SD-JWT issuer (iss) claim is missing'] };
    }

    const jwks = await resolveIssuerJwks(issuer, config);
    if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      return {
        valid: false,
        reasons: [`No trusted issuer keys found for issuer: ${issuer}`]
      };
    }

    const verification = await verifyWithJwks(issuerJwt, jwks, issuer);
    const verifiedPayload = verification.payload as Record<string, unknown>;
    const digestAlg = typeof verifiedPayload._sd_alg === 'string' ? verifiedPayload._sd_alg : 'sha-256';

    const disclosuresByDigest = new Map<string, DisclosureEntry>();
    for (const disclosure of decodeDisclosures(disclosureSegments).values()) {
      const digest = hashDisclosure(disclosure.encoded, digestAlg);
      disclosuresByDigest.set(digest, disclosure);
    }

    const usedDigests = new Set<string>();
    const claims = applyDisclosuresRecursively(
      verifiedPayload,
      disclosuresByDigest,
      usedDigests,
      reasons
    ) as Record<string, unknown>;

    for (const digest of disclosuresByDigest.keys()) {
      if (!usedDigests.has(digest)) {
        reasons.push(`Unbound disclosure detected for digest: ${digest}`);
      }
    }

    for (const requiredClaim of input.requiredClaims) {
      if (claims[requiredClaim] === undefined) {
        reasons.push(`Missing required claim: ${requiredClaim}`);
      }
    }

    const expectedAudience = input.expectedAudience;
    if (maybeKbJwt) {
      const holderJwk =
        claims.cnf && typeof claims.cnf === 'object' && (claims.cnf as Record<string, unknown>).jwk
          ? ((claims.cnf as Record<string, unknown>).jwk as JWK)
          : undefined;

      if (!holderJwk) {
        reasons.push('Key binding JWT present but cnf.jwk is missing in SD-JWT VC');
      } else {
        try {
          const kbHeader = decodeProtectedHeader(maybeKbJwt);
          const holderKey = await importJWK(holderJwk, kbHeader.alg);
          const kbResult = await jwtVerify(maybeKbJwt, holderKey, {
            audience: expectedAudience
          });
          if (kbResult.payload.nonce !== input.expectedNonce) {
            reasons.push('Key binding JWT nonce mismatch');
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown key binding JWT verification failure';
          reasons.push(`Key binding JWT invalid: ${message}`);
        }
      }
    }

    return {
      valid: reasons.length === 0,
      reasons,
      claims,
      issuer,
      credentialType: typeof claims.vct === 'string' ? claims.vct : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown SD-JWT verification failure';
    return {
      valid: false,
      reasons: [message]
    };
  }
}

export function pickVpTokenForVerification(vpToken: string | string[]): string {
  return extractPresentedSdJwt(vpToken);
}
