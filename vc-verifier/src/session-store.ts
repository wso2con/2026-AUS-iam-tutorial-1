import { randomBytes } from 'node:crypto';
import type { VPRequestStatus, VerificationResult, VerificationSession } from './types';

function randomB64Url(size = 16): string {
  return randomBytes(size)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export class SessionStore {
  private readonly sessions = new Map<string, VerificationSession>();
  private readonly sessionIdByState = new Map<string, string>();

  constructor(private readonly sessionTtlSeconds: number) {}

  createSession(input: {
    id: string;
    requestUri: string;
    callbackUri: string;
    clientId: string;
    requestIssuer: string;
    requestDcql: VerificationSession['requestDcql'];
    requestJwt?: string;
  }): VerificationSession {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.sessionTtlSeconds * 1000);

    const session: VerificationSession = {
      id: input.id,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      nonce: randomB64Url(24),
      state: input.id,
      requestUri: input.requestUri,
      callbackUri: input.callbackUri,
      clientId: input.clientId,
      requestIssuer: input.requestIssuer,
      requestDcql: input.requestDcql,
      requestJwt: input.requestJwt || '',
      status: 'ACTIVE',
      used: false
    };

    this.sessions.set(session.id, session);
    this.sessionIdByState.set(session.state, session.id);
    return session;
  }

  setRequestJwt(sessionId: string, requestJwt: string): VerificationSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.requestJwt = requestJwt;
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): VerificationSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    this.ensureExpiry(session);
    return session;
  }

  getSessionByState(state: string): VerificationSession | undefined {
    const sessionId = this.sessionIdByState.get(state);
    if (!sessionId) {
      return undefined;
    }

    return this.getSession(sessionId);
  }

  isExpired(session: VerificationSession): boolean {
    return Date.now() > new Date(session.expiresAt).getTime();
  }

  updateStatus(sessionId: string, status: VPRequestStatus): VerificationSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.status = status;
    this.sessions.set(sessionId, session);
    return session;
  }

  markSubmitted(sessionId: string): VerificationSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.status = 'VP_SUBMITTED';
    session.lastCallbackAt = new Date().toISOString();
    this.sessions.set(sessionId, session);
    return session;
  }

  markUsed(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.used = true;
    session.lastCallbackAt = new Date().toISOString();
    this.sessions.set(sessionId, session);
  }

  saveResult(sessionId: string, result: VerificationResult): VerificationSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.verificationResult = result;
    session.status = result.valid ? 'VERIFIED' : 'FAILED';
    session.lastCallbackAt = new Date().toISOString();
    this.sessions.set(sessionId, session);
    return session;
  }

  markFailure(sessionId: string, reasons: string[]): VerificationSession | undefined {
    const result: VerificationResult = {
      valid: false,
      reasons,
      verifiedAt: new Date().toISOString()
    };

    return this.saveResult(sessionId, result);
  }

  cleanupExpired(maxAgeMs = 30 * 60 * 1000): void {
    for (const [id, session] of this.sessions.entries()) {
      this.ensureExpiry(session);

      const ageMs = Date.now() - new Date(session.createdAt).getTime();
      if (ageMs > maxAgeMs) {
        this.sessionIdByState.delete(session.state);
        this.sessions.delete(id);
      }
    }
  }

  private ensureExpiry(session: VerificationSession): void {
    if (this.isExpired(session) && session.status === 'ACTIVE') {
      session.status = 'EXPIRED';
      this.sessions.set(session.id, session);
    }
  }
}
