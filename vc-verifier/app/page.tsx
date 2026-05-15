'use client';

import { useEffect, useRef, useState } from 'react';

type PageState = 'ready' | 'waiting' | 'checking' | 'verified' | 'failed' | 'expired';

interface VerificationResult {
  valid: boolean;
  reasons?: string[];
  claims?: Record<string, unknown>;
  issuer?: string;
  verifiedAt: string;
}

interface StatusPayload {
  status: 'ACTIVE' | 'VP_SUBMITTED' | 'VERIFIED' | 'FAILED' | 'EXPIRED';
  expiresAt: string;
  verificationResult?: VerificationResult;
}

interface SessionResponse {
  session: {
    id: string;
    expiresAt: string;
  };
  qrDataUrl: string;
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="2.8" width="10" height="18.4" rx="2" />
      <path d="M11.8 18h.4" />
    </svg>
  );
}

function PlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.4 12.8 21 4.2l-8.6 17.4-2.2-7.8-6.8-1Z" />
      <path d="m10.2 13.8 4.4-4.4" />
    </svg>
  );
}

function formatClock(date: Date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatExpiry(expiresAtMs: number | null) {
  if (!expiresAtMs) {
    return '--:--';
  }

  const remainingSeconds = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
  if (remainingSeconds <= 0) {
    return 'expired';
  }

  const minutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const seconds = String(remainingSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function Home() {
  const [pageState, setPageState] = useState<PageState>('ready');
  const [clock, setClock] = useState('--:--:--');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [expiryText, setExpiryText] = useState('--:--');
  const [isCreating, setIsCreating] = useState(false);
  const pollHandle = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalTransitionHandle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollHandle.current) {
      clearInterval(pollHandle.current);
      pollHandle.current = null;
    }
  };

  const clearFinalTransition = () => {
    if (finalTransitionHandle.current) {
      clearTimeout(finalTransitionHandle.current);
      finalTransitionHandle.current = null;
    }
  };

  const setExpiry = (value?: string) => {
    if (!value) {
      setExpiresAtMs(null);
      setExpiryText('--:--');
      return;
    }

    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      setExpiresAtMs(null);
      setExpiryText('--:--');
      return;
    }

    setExpiresAtMs(parsed);
    setExpiryText(formatExpiry(parsed));
  };

  const resetSession = () => {
    stopPolling();
    clearFinalTransition();
    setPageState('ready');
    setActiveRequestId(null);
    setQrDataUrl('');
    setExpiry();
    setIsCreating(false);
  };

  const showVerifiedAfterValidation = () => {
    clearFinalTransition();
    setPageState('checking');
    finalTransitionHandle.current = setTimeout(() => {
      setPageState('verified');
      finalTransitionHandle.current = null;
    }, 1500);
  };

  const renderLifecycle = (statusPayload: StatusPayload) => {
    setExpiry(statusPayload.expiresAt);

    if (statusPayload.status === 'ACTIVE') {
      setPageState('waiting');
      return false;
    }

    if (statusPayload.status === 'VP_SUBMITTED') {
      setPageState('checking');
      return false;
    }

    if (statusPayload.status === 'VERIFIED') {
      showVerifiedAfterValidation();
      return true;
    }

    if (statusPayload.status === 'FAILED') {
      setPageState('failed');
      return true;
    }

    if (statusPayload.status === 'EXPIRED') {
      setPageState('expired');
      return true;
    }

    setPageState('failed');
    return true;
  };

  const pollStatus = async (requestId: string) => {
    const response = await fetch(`/openid4vp/authorization-request/${encodeURIComponent(requestId)}/status`);
    if (!response.ok) {
      setPageState('failed');
      stopPolling();
      return;
    }

    const statusPayload = (await response.json()) as StatusPayload;
    const shouldStop = renderLifecycle(statusPayload);
    if (shouldStop) {
      stopPolling();
    }
  };

  const createRequest = async () => {
    setIsCreating(true);
    stopPolling();
    clearFinalTransition();
    setActiveRequestId(null);
    setQrDataUrl('');
    setExpiry();
    setPageState('waiting');

    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        setPageState('failed');
        return;
      }

      const payload = (await response.json()) as SessionResponse;
      setActiveRequestId(payload.session.id);
      setQrDataUrl(payload.qrDataUrl);
      setExpiry(payload.session.expiresAt);
      setPageState('waiting');

      pollHandle.current = setInterval(() => {
        void pollStatus(payload.session.id);
      }, 2500);
    } catch {
      setPageState('failed');
    } finally {
      setIsCreating(false);
    }
  };

  useEffect(() => {
    const tick = () => {
      setClock(formatClock(new Date()));
      setExpiryText(formatExpiry(expiresAtMs));
    };

    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [expiresAtMs]);

  useEffect(() => () => {
    stopPolling();
    clearFinalTransition();
  }, []);

  const isScanPhase = pageState === 'waiting';
  const isValidating = pageState === 'checking';
  const isComplete = pageState === 'verified';
  const isRecoverableError = pageState === 'failed' || pageState === 'expired';

  return (
    <main className="kiosk-shell">
      <section className="kiosk" data-state={pageState}>
        <header className="kiosk-header">
          <div className="kiosk-route">
            <span>Terminal 2 / Lounge Access</span>
            <span className="divider" />
            <span>Passenger Eligibility Check</span>
          </div>
          <time className="kiosk-clock">{clock}</time>
        </header>

        <div className="kiosk-main">
          <aside className="scanner-rail">
            {pageState === 'ready' ? (
              <div className="rail-panel enter-panel">
                <div className="microcopy green">Welcome to SkyLink</div>
                <h1>Lounge<br />Access</h1>
                <button className="start-btn" onClick={createRequest} disabled={isCreating}>
                  {isCreating ? 'Preparing...' : 'Start Access Check'}
                </button>
              </div>
            ) : null}

            {isScanPhase || isValidating ? (
              <div className="rail-panel scan-panel">
                <div className={`qr-card ${isValidating ? 'qr-card-muted' : ''}`}>
                  {qrDataUrl ? (
                    <img id="wallet-qr" src={qrDataUrl} alt="Lounge access scan code" />
                  ) : (
                    <div className="qr-placeholder">Preparing</div>
                  )}
                  {isValidating ? <div className="qr-overlay"><span /></div> : null}
                </div>

                <div className="rail-separator" />
                <div className="rail-status">
                  <div className={isValidating ? 'microcopy amber pulse-text' : 'microcopy green'}>
                    {isValidating ? 'Checking Access...' : 'Scan Code'}
                  </div>
                  <p>{isValidating ? 'Processing securely' : `Session expires in ${expiryText}`}</p>
                </div>
              </div>
            ) : null}

            {isComplete ? (
              <div className="rail-panel complete-panel">
                <div className="round-icon"><PlaneIcon /></div>
                <div className="microcopy green">Access Verified</div>
                <p>Your lounge access has been approved.</p>
                <button className="ghost-btn" onClick={resetSession}>Start Over</button>
              </div>
            ) : null}

            {isRecoverableError ? (
              <div className="rail-panel complete-panel">
                <div className="round-icon warning-mark">!</div>
                <div className="microcopy amber">{pageState === 'expired' ? 'Session Expired' : 'Access Not Verified'}</div>
                <p>{pageState === 'expired' ? 'Start again to get a fresh code.' : 'Please try again or ask a lounge agent for help.'}</p>
                <button className="ghost-btn" onClick={resetSession}>Start Over</button>
              </div>
            ) : null}
          </aside>

          <section className="story-stage">
            {pageState === 'ready' ? (
              <div className="stage-panel idle-stage">
                <PlaneIcon />
                <h2>SkyLink<br />Secure</h2>
              </div>
            ) : null}

            {isScanPhase ? (
              <div className="stage-panel instruction-stage">
                <h2>Scan for Lounge Access</h2>
                <p>Open your wallet and present your digital membership to continue.</p>
              </div>
            ) : null}

            {isValidating ? (
              <div className="stage-panel validating-stage">
                <div className="validation-spinner" />
                <h2>Validating...</h2>
                <p>Checking disclosed access details</p>
              </div>
            ) : null}

            {isComplete ? (
              <div className="stage-panel verified-stage">
                <div className="access-success-card">
                  <div className="access-success-mark"><PlaneIcon /></div>
                  <div className="field-label">Access Status</div>
                  <h2>Lounge Access Verified</h2>
                  <p>You may proceed to the lounge.</p>
                </div>
              </div>
            ) : null}

            {isRecoverableError ? (
              <div className="stage-panel validating-stage">
                <div className="validation-spinner danger-spinner" />
                <h2>{pageState === 'expired' ? 'Session Expired' : 'Try Again'}</h2>
                <p>{pageState === 'expired' ? 'Start again to get a fresh access code.' : 'We could not verify lounge access.'}</p>
              </div>
            ) : null}
          </section>
        </div>

        <footer className="kiosk-footer">
          <div className="footer-actions">
            <button onClick={resetSession}>F1: Reset Session</button>
            {isComplete ? <button className="seat-action">F2: Continue <span>-&gt;</span></button> : null}
          </div>
          <div>System Secure • v4.8.2</div>
        </footer>
      </section>
    </main>
  );
}
