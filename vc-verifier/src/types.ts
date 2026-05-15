export interface VerifierConfig {
  port: number;
  appBaseUrl: string;
  sessionTtlSeconds: number;
  requiredClaims: string[];
  verifierIssuer: string;
  verifierRedirectUri: string;
  requestAudience: string;
  clientMetadata: {
    clientName: string;
    logoUri?: string;
    redirectUris: string[];
    policyUri?: string;
    clientUri?: string;
    vpFormatsSupported: {
      'dc+sd-jwt': {
        'sd-jwt_alg_values': string[];
        'kb-jwt_alg_values': string[];
        'alg_values'?: string[];
      };
      mso_mdoc?: {
        'issuerauth_alg_values': number[];
        'deviceauth_alg_values': number[];
        'alg_values': string[];
      };
    };
  };
  requestDcql: {
    credentialId: string;
    vctValues: string[];
    claims: DcqlClaim[];
  };
  allowRemoteJwks: boolean;
  trustedIssuerJwks: Record<string, JsonWebKeySet>;
  requestJwtTtlSeconds: number;
  requestSigningPrivateJwk: JsonWebKey;
  requestSigningKid?: string;
  requestSigningAlg?: string;
  logRawVpToken: boolean;
}

export interface JsonWebKeySet {
  keys: JsonWebKey[];
}

export interface VerificationSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  nonce: string;
  state: string;
  requestUri: string;
  callbackUri: string;
  clientId: string;
  requestIssuer: string;
  requestDcql: DcqlQuery;
  requestJwt: string;
  status: VPRequestStatus;
  used: boolean;
  verificationResult?: VerificationResult;
  lastCallbackAt?: string;
}

export type VPRequestStatus = 'ACTIVE' | 'VP_SUBMITTED' | 'VERIFIED' | 'FAILED' | 'EXPIRED';

export interface Oid4vpAuthRequest {
  client_id: string;
  response_type: 'vp_token';
  response_mode: 'direct_post';
  response_uri: string;
  redirect_uri: string;
  aud: string;
  nonce: string;
  state: string;
  wallet_nonce?: string;
  client_metadata: {
    client_name: string;
    logo_uri?: string;
    redirect_uris: string[];
    policy_uri?: string;
    client_uri?: string;
    vp_formats: Record<string, never>;
    vp_formats_supported: {
      'dc+sd-jwt': {
        'sd-jwt_alg_values': string[];
        'kb-jwt_alg_values': string[];
        'alg_values'?: string[];
      };
      mso_mdoc?: {
        'issuerauth_alg_values': number[];
        'deviceauth_alg_values': number[];
        'alg_values': string[];
      };
    };
  };
  dcql_query: DcqlQuery;
}

export interface DcqlClaim {
  id: string;
  path: string[];
}

export interface DcqlQuery {
  credentials: Array<{
    id: string;
    format: 'dc+sd-jwt';
    meta?: {
      vct_values: string[];
    };
    claims: DcqlClaim[];
  }>;
}

export interface WalletCallbackPayload {
  vp_token: string | string[];
  state: string;
  presentation_submission?: {
    id?: string;
    definition_id?: string;
    descriptor_map?: Array<{
      id?: string;
      format?: string;
      path?: string;
    }>;
  };
}

export interface VerificationResult {
  valid: boolean;
  reasons: string[];
  claims?: Record<string, unknown>;
  issuer?: string;
  credentialType?: string;
  verifiedAt: string;
}

export interface VerifySdJwtInput {
  sdJwtPresentation: string;
  expectedNonce: string;
  expectedAudience: string;
  requiredClaims: string[];
}

export interface VerifySdJwtOutput {
  valid: boolean;
  reasons: string[];
  claims?: Record<string, unknown>;
  issuer?: string;
  credentialType?: string;
}
