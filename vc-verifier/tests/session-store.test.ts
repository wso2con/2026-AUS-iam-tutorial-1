import { describe, expect, it } from 'vitest';
import { SessionStore } from '../src/session-store';

describe('SessionStore', () => {
  it('creates request state and handles lifecycle transitions', async () => {
    const store = new SessionStore(1);
    const session = store.createSession({
      id: 'req-1',
      requestUri: 'https://verifier.example/openid4vp/authorization-request/req-1',
      callbackUri: 'https://verifier.example/openid4vp/authorization-response',
      clientId: 'redirect_uri:https://verifier.example/openid4vp/authorization-response',
      requestIssuer: 'https://verifier.example',
      requestDcql: {
        credentials: [
          {
            id: 'sd-jwt-pid',
            format: 'dc+sd-jwt',
            claims: [{ id: 'given_name', path: ['given_name'] }]
          }
        ]
      }
    });

    expect(store.getSession(session.id)?.status).toBe('ACTIVE');

    store.markSubmitted(session.id);
    expect(store.getSession(session.id)?.status).toBe('VP_SUBMITTED');

    store.markUsed(session.id);
    expect(store.getSession(session.id)?.used).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const expiredSession = store.getSession(session.id);
    expect(expiredSession?.status).toBe('VP_SUBMITTED');

    const activeSession = store.createSession({
      id: 'req-2',
      requestUri: 'https://verifier.example/openid4vp/authorization-request/req-2',
      callbackUri: 'https://verifier.example/openid4vp/authorization-response',
      clientId: 'redirect_uri:https://verifier.example/openid4vp/authorization-response',
      requestIssuer: 'https://verifier.example',
      requestDcql: {
        credentials: [
          {
            id: 'sd-jwt-pid',
            format: 'dc+sd-jwt',
            claims: [{ id: 'given_name', path: ['given_name'] }]
          }
        ]
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(store.getSession(activeSession.id)?.status).toBe('EXPIRED');
  });
});
