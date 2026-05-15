import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

export interface SdJwtFixture {
  presentation: string;
  issuer: string;
  publicJwk: JWK;
}

type FixtureClaim = 'given_name' | 'family_name' | 'birthdate' | 'membership_number' | 'lounge_tier';

function b64urlJson(data: unknown): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

function hashDisclosure(encoded: string): string {
  return createHash('sha256').update(encoded).digest('base64url');
}

function salt(): string {
  return randomBytes(8).toString('base64url');
}

export async function createSdJwtFixture(options?: {
  issuer?: string;
  includeClaims?: FixtureClaim[];
  undisclosedClaims?: FixtureClaim[];
  tamperSignature?: boolean;
}): Promise<SdJwtFixture> {
  const issuer = options?.issuer ?? 'https://issuer.example';
  const includeClaims = options?.includeClaims ?? ['given_name', 'family_name', 'birthdate'];
  const undisclosedClaims = options?.undisclosedClaims ?? [];

  const disclosures: string[] = [];
  const digests: string[] = [];

  const claimValues: Record<FixtureClaim, string> = {
    given_name: 'Alice',
    family_name: 'Smith',
    birthdate: '1999-04-12',
    membership_number: 'SLK-99881',
    lounge_tier: 'Gold'
  };

  for (const claim of includeClaims) {
    const disclosure = b64urlJson([salt(), claim, claimValues[claim]]);
    disclosures.push(disclosure);
    digests.push(hashDisclosure(disclosure));
  }

  for (const claim of undisclosedClaims) {
    if (includeClaims.includes(claim)) {
      continue;
    }
    const disclosure = b64urlJson([salt(), claim, claimValues[claim]]);
    digests.push(hashDisclosure(disclosure));
  }

  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'issuer-key-1';
  publicJwk.alg = 'ES256';

  const payload = {
    iss: issuer,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    vct: 'https://example.org/vct/identity_credential',
    _sd_alg: 'sha-256',
    _sd: digests
  };

  const signer = new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: 'issuer-key-1', typ: 'vc+sd-jwt' });
  let issuerJwt = await signer.sign(privateKey);

  if (options?.tamperSignature) {
    const parts = issuerJwt.split('.');
    parts[1] = Buffer.from('{"iss":"https://issuer.example","sub":"tampered"}', 'utf8').toString('base64url');
    issuerJwt = parts.join('.');
  }

  return {
    presentation: [issuerJwt, ...disclosures].join('~'),
    issuer,
    publicJwk
  };
}
