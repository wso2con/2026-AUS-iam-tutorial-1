import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { loadConfig } from './config';
import { logEvent } from './logger';
import {
  buildCallbackUri,
  buildDcqlQueryFromConfig,
  buildLissiRequestUriDeepLink,
  buildQrDataUrl,
  buildRequestUri
} from './oid4vp';
import { buildSignedRequestJwt, deriveRedirectUriClientId } from './request-jwt';
import { SessionStore } from './session-store';
import { pickVpTokenForVerification, verifySdJwtPresentation } from './sdjwt';
import type { VerificationSession, VerifierConfig, WalletCallbackPayload } from './types';

const createSessionSchema = z.object({}).strict().optional();

const callbackPayloadSchema = z.object({
  vp_token: z.union([z.string(), z.array(z.string())]),
  state: z.string().min(1),
  presentation_submission: z
    .object({
      id: z.string().optional(),
      definition_id: z.string().optional(),
      descriptor_map: z
        .array(
          z.object({
            id: z.string().optional(),
            format: z.string().optional(),
            path: z.string().optional()
          })
        )
        .optional()
    })
    .optional()
});

export interface VerifierRuntime {
  config: VerifierConfig;
  store: SessionStore;
}

declare global {
  // Reuse the in-memory store across hot reloads and warm serverless invocations.
  // Vercel can still cold-start a fresh store; use external storage for production.
  // eslint-disable-next-line no-var
  var __skylinkVerifierRuntime: VerifierRuntime | undefined;
}

export function getRuntime(config: VerifierConfig = loadConfig()): VerifierRuntime {
  if (!globalThis.__skylinkVerifierRuntime) {
    globalThis.__skylinkVerifierRuntime = {
      config,
      store: new SessionStore(config.sessionTtlSeconds)
    };
  }

  return globalThis.__skylinkVerifierRuntime;
}

export function toStatusResponse(session: VerificationSession) {
  return {
    requestId: session.id,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    lastCallbackAt: session.lastCallbackAt,
    verificationResult: session.verificationResult
  };
}

function extractVpTokenFromDcqlObject(
  vpTokenObject: Record<string, unknown>,
  preferredCredentialId: string
): string | string[] | undefined {
  const tryExtract = (value: unknown): string | string[] | undefined => {
    if (typeof value === 'string') {
      return value;
    }
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return value as string[];
    }
    return undefined;
  };

  const preferred = tryExtract(vpTokenObject[preferredCredentialId]);
  if (preferred) {
    return preferred;
  }

  for (const value of Object.values(vpTokenObject)) {
    const extracted = tryExtract(value);
    if (extracted) {
      return extracted;
    }
  }

  return undefined;
}

export function normalizeWalletPayload(
  body: Record<string, unknown>,
  preferredCredentialId: string
): WalletCallbackPayload {
  let presentationSubmission = body.presentation_submission;
  let vpToken = body.vp_token;

  if (typeof presentationSubmission === 'string') {
    try {
      presentationSubmission = JSON.parse(presentationSubmission);
    } catch {
      // Leave as-is so schema validation fails with a clear error.
    }
  }

  if (typeof vpToken === 'string') {
    const trimmed = vpToken.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsedVpToken = JSON.parse(trimmed);
        if (typeof parsedVpToken === 'string' || Array.isArray(parsedVpToken)) {
          vpToken = parsedVpToken;
        } else if (parsedVpToken && typeof parsedVpToken === 'object') {
          const extracted = extractVpTokenFromDcqlObject(
            parsedVpToken as Record<string, unknown>,
            preferredCredentialId
          );
          if (extracted) {
            vpToken = extracted;
          }
        }
      } catch {
        // Keep original value when parse fails.
      }
    }
  } else if (vpToken && typeof vpToken === 'object' && !Array.isArray(vpToken)) {
    const extracted = extractVpTokenFromDcqlObject(
      vpToken as Record<string, unknown>,
      preferredCredentialId
    );
    if (extracted) {
      vpToken = extracted;
    }
  }

  return {
    vp_token: vpToken as string | string[],
    state: body.state as string,
    presentation_submission: presentationSubmission as WalletCallbackPayload['presentation_submission']
  };
}

function normalizeRequestUriPostBody(body: Record<string, unknown>): {
  walletNonce?: string;
} {
  const walletNonceValue = body.wallet_nonce;
  const walletNonce = Array.isArray(walletNonceValue)
    ? (typeof walletNonceValue[0] === 'string' ? walletNonceValue[0] : undefined)
    : (typeof walletNonceValue === 'string' ? walletNonceValue : undefined);
  return { walletNonce };
}

function detectVpTokenFormat(vpToken: string | string[]): {
  format: 'dc+sd-jwt' | 'jwt' | 'json' | 'unknown';
  tokenCount: number;
  hasDisclosures: boolean;
  hasJwtParts: boolean;
} {
  const token = Array.isArray(vpToken) ? vpToken[0] : vpToken;
  const tokenCount = Array.isArray(vpToken) ? vpToken.length : 1;
  const candidate = typeof token === 'string' ? token.trim() : '';
  const hasDisclosures = candidate.includes('~');
  const firstSegment = candidate.split('~')[0] || '';
  const hasJwtParts = firstSegment.split('.').length === 3;

  if (hasJwtParts && hasDisclosures) {
    return { format: 'dc+sd-jwt', tokenCount, hasDisclosures, hasJwtParts };
  }

  if (hasJwtParts) {
    return { format: 'jwt', tokenCount, hasDisclosures, hasJwtParts };
  }

  if (candidate.startsWith('{') || candidate.startsWith('[')) {
    return { format: 'json', tokenCount, hasDisclosures, hasJwtParts };
  }

  return { format: 'unknown', tokenCount, hasDisclosures, hasJwtParts };
}

function inspectVpTokenStructure(vpToken: string | string[]) {
  const token = Array.isArray(vpToken) ? vpToken[0] : vpToken;
  const raw = typeof token === 'string' ? token : '';
  const issuerJwt = raw.split('~')[0] || '';
  const jwtParts = issuerJwt.split('.');
  const protectedHeaderSegment = jwtParts[0] || '';
  const hasInvalidBase64UrlChars = /[^A-Za-z0-9\-_]/.test(protectedHeaderSegment);

  let decodedHeaderPreview: string | undefined;
  let headerDecodeError: string | undefined;
  try {
    decodedHeaderPreview = Buffer.from(protectedHeaderSegment, 'base64url').toString('utf8');
  } catch (error) {
    headerDecodeError = error instanceof Error ? error.message : 'unknown base64url decode error';
  }

  return {
    rawLength: raw.length,
    issuerJwtLength: issuerJwt.length,
    issuerJwtPartCount: jwtParts.length,
    protectedHeaderSegmentLength: protectedHeaderSegment.length,
    protectedHeaderHasInvalidBase64UrlChars: hasInvalidBase64UrlChars,
    decodedHeaderPreview: decodedHeaderPreview?.slice(0, 200),
    headerDecodeError
  };
}

function isSupportedRequestObjectContentType(contentType: string): boolean {
  return contentType.includes('application/x-www-form-urlencoded') || contentType.includes('application/json');
}

function isSupportedWalletResponseContentType(contentType: string): boolean {
  return (
    contentType.includes('application/json') ||
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  );
}

export async function createVerificationSession(body: unknown, runtime = getRuntime()) {
  const parsedCreateRequest = createSessionSchema.safeParse(body);
  if (!parsedCreateRequest.success) {
    return {
      status: 400,
      body: {
        error: 'invalid_session_request',
        details: parsedCreateRequest.error.issues.map((issue) => issue.message)
      }
    };
  }

  const { config, store } = runtime;
  const requestIssuer = config.verifierIssuer;
  const requestDcqlConfig = config.requestDcql;
  const requestDcql = buildDcqlQueryFromConfig(requestDcqlConfig);

  const requestId = uuidv4();
  const requestUri = buildRequestUri(requestId, config.appBaseUrl);
  const callbackUri = buildCallbackUri(config.appBaseUrl);
  const clientId = deriveRedirectUriClientId(callbackUri);

  const session = store.createSession({
    id: requestId,
    requestUri,
    callbackUri,
    clientId,
    requestIssuer,
    requestDcql
  });

  const { jwt, payload } = await buildSignedRequestJwt(
    {
      requestId,
      callbackUri,
      nonce: session.nonce,
      state: session.state,
      clientId,
      requestIssuer: session.requestIssuer,
      dcqlQuery: session.requestDcql
    },
    config
  );

  store.setRequestJwt(session.id, jwt);

  const walletLink = buildLissiRequestUriDeepLink(requestUri, clientId);
  const qrDataUrl = await buildQrDataUrl(walletLink);

  logEvent('request.created', {
    requestId: session.id,
    requestUri,
    responseUri: callbackUri,
    clientId,
    requestIssuer,
    credentialId: requestDcqlConfig.credentialId,
    expiresAt: session.expiresAt
  });

  return {
    status: 201,
    body: {
      session: store.getSession(session.id),
      requestObject: payload,
      requestUri,
      walletLink,
      qrDataUrl
    }
  };
}

export async function getRequestObjectJwt(
  requestId: string,
  method: 'GET' | 'POST',
  contentType: string,
  body: Record<string, unknown>,
  runtime = getRuntime()
) {
  const { config, store } = runtime;
  const session = store.getSession(requestId);
  if (!session) {
    return { status: 404, body: { error: 'request_not_found' } };
  }

  if (store.isExpired(session)) {
    store.updateStatus(session.id, 'EXPIRED');
    return { status: 410, body: { error: 'request_expired' } };
  }

  if (method === 'POST') {
    if (!isSupportedRequestObjectContentType(contentType)) {
      return { status: 415, body: { error: 'unsupported_content_type' } };
    }

    const { walletNonce } = normalizeRequestUriPostBody(body);
    if (walletNonce) {
      const rebuilt = await buildSignedRequestJwt(
        {
          requestId: session.id,
          callbackUri: session.callbackUri,
          nonce: session.nonce,
          state: session.state,
          clientId: session.clientId,
          requestIssuer: session.requestIssuer,
          dcqlQuery: session.requestDcql,
          walletNonce
        },
        config
      );
      store.setRequestJwt(session.id, rebuilt.jwt);
    }
  }

  const latestSession = store.getSession(session.id);
  return {
    status: 200,
    jwt: latestSession?.requestJwt || session.requestJwt
  };
}

export function getRequestStatus(requestId: string, runtime = getRuntime()) {
  const { store } = runtime;
  const session = store.getSession(requestId);
  if (!session) {
    return { status: 404, body: { error: 'request_not_found' } };
  }

  if (store.isExpired(session)) {
    store.updateStatus(session.id, 'EXPIRED');
  }

  return { status: 200, body: toStatusResponse(session) };
}

export async function handleWalletResponse(
  body: Record<string, unknown>,
  contentType: string,
  runtime = getRuntime()
) {
  const { config, store } = runtime;

  logEvent('response.received', {
    contentType: contentType || 'unknown'
  });

  if (!isSupportedWalletResponseContentType(contentType)) {
    return { status: 415, body: { error: 'unsupported_content_type' } };
  }

  const normalizedPayload = normalizeWalletPayload(body, config.requestDcql.credentialId);
  const parsed = callbackPayloadSchema.safeParse(normalizedPayload);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: 'invalid_payload',
        details: parsed.error.issues.map((issue) => issue.message)
      }
    };
  }

  const payload = parsed.data;
  const session = store.getSessionByState(payload.state);
  const vpTokenDiagnostics = detectVpTokenFormat(payload.vp_token);
  const vpTokenStructure = inspectVpTokenStructure(payload.vp_token);

  if (!session) {
    return { status: 400, body: { error: 'unknown_or_invalid_state' } };
  }

  if (store.isExpired(session)) {
    store.updateStatus(session.id, 'EXPIRED');
    store.markUsed(session.id);
    return { status: 410, body: { error: 'request_expired' } };
  }

  if (session.used) {
    return { status: 409, body: { error: 'replay_detected' } };
  }

  store.markSubmitted(session.id);

  let result;
  try {
    const presentedSdJwt = pickVpTokenForVerification(payload.vp_token);
    logEvent('response.vp_token_diagnostics', {
      requestId: session.id,
      state: payload.state,
      detectedFormat: vpTokenDiagnostics.format,
      tokenCount: vpTokenDiagnostics.tokenCount,
      hasDisclosures: vpTokenDiagnostics.hasDisclosures,
      hasJwtParts: vpTokenDiagnostics.hasJwtParts,
      ...vpTokenStructure
    });
    if (config.logRawVpToken) {
      logEvent('response.vp_token_raw', {
        requestId: session.id,
        state: payload.state,
        vpToken: payload.vp_token
      });
    }

    if (vpTokenDiagnostics.format !== 'dc+sd-jwt') {
      result = {
        valid: false,
        reasons: [
          `Unsupported vp_token format: ${vpTokenDiagnostics.format}. Expected dc+sd-jwt presentation.`
        ]
      };
    } else {
      result = await verifySdJwtPresentation(
        {
          sdJwtPresentation: presentedSdJwt,
          expectedNonce: session.nonce,
          expectedAudience: session.clientId,
          requiredClaims: config.requiredClaims
        },
        config
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown callback verification failure';
    result = {
      valid: false,
      reasons: [message]
    };
  }

  store.markUsed(session.id);

  const normalizedResult = {
    ...result,
    verifiedAt: new Date().toISOString()
  };

  store.saveResult(session.id, normalizedResult);

  logEvent('response.processed', {
    requestId: session.id,
    valid: normalizedResult.valid,
    status: normalizedResult.valid ? 'VERIFIED' : 'FAILED',
    reasons: normalizedResult.reasons,
    issuer: normalizedResult.issuer
  });

  return {
    status: 200,
    body: {
      received: true,
      valid: normalizedResult.valid,
      reasons: normalizedResult.reasons,
      requestId: session.id
    }
  };
}

export function getSession(sessionId: string, runtime = getRuntime()) {
  const { store } = runtime;
  const session = store.getSession(sessionId);
  if (!session) {
    return { status: 404, body: { error: 'session_not_found' } };
  }

  if (store.isExpired(session) && session.status === 'ACTIVE') {
    store.updateStatus(session.id, 'EXPIRED');
  }

  return { status: 200, body: session };
}
