import { useEffect, useRef, useState } from "react";
import { useAsgardeo } from "@asgardeo/react";
import {
  ChevronDown,
  CircleUserRound,
  LogOut,
  MessageCircle,
  Send,
  ShieldCheck,
  X
} from "lucide-react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { useApiAuth, useLocationQuery } from "./api-queries";
import {
  clearCDSCookies,
  createSignInConfigWithCDSTracker,
  ensureCDSProfile,
  initializeCDSFromCookie
} from "./cds-api";
import { BookingDetailsPageWithAuth } from "./pages/BookingDetailsPageWithAuth";
import { BookingsPageWithAuth } from "./pages/BookingsPageWithAuth";
import { BookingsUnavailable } from "./pages/BookingsUnavailable";
import { FlightDetailsPage } from "./pages/FlightDetailsPage";
import { HomePage, SignedInHomePage } from "./pages/HomePage";
import { PaymentPageWithAuth } from "./pages/PaymentPageWithAuth";
import { ProfilePageWithAuth } from "./pages/ProfilePageWithAuth";
import { ResultsPage, ResultsPageWithAuth } from "./pages/ResultsPage";
import { buildResultsPath, readCriteria } from "./utils/routes";
import wayfinderLogo from "./assets/wayfinder-logo.png";

const AGENT_CHAT_URL = import.meta.env.VITE_AGENT_CHAT_URL || "ws://localhost:8790/chat";
const ASGARDEO_BASE_URL = import.meta.env.VITE_ASGARDEO_BASE_URL || "";
const ASGARDEO_ORG_NAME = getAsgardeoOrgName();
const SIGN_UP_URL = ASGARDEO_ORG_NAME
  ? `https://accounts.asgardeo.io/t/${encodeURIComponent(ASGARDEO_ORG_NAME)}/accounts/register`
  : "https://accounts.asgardeo.io/accounts/register";
const DEFAULT_DEAL_ALERT_CRITERIA = {
  minimumSavingsPercent: 10,
  maxStops: null,
  timePreference: "any",
  sameCabinOnly: true
};

function getAsgardeoOrgName() {
  const configuredOrgName = import.meta.env.VITE_ASGARDEO_ORG_NAME?.trim();

  if (configuredOrgName) {
    return configuredOrgName;
  }

  if (!ASGARDEO_BASE_URL) {
    return "";
  }

  try {
    const pathParts = new URL(ASGARDEO_BASE_URL).pathname.split("/").filter(Boolean);
    const tenantIndex = pathParts.indexOf("t");

    return tenantIndex >= 0 ? pathParts[tenantIndex + 1] || "" : "";
  } catch {
    return "";
  }
}

function createChatMessage(role, content, options = {}) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    ...options
  };
}

function BrandLogo({ className = "" }) {
  return (
    <img
      className={`brand-logo${className ? ` ${className}` : ""}`}
      src={wayfinderLogo}
      alt="Wayfinder Travel logo"
    />
  );
}

function isFlightLandingPath(pathname) {
  return pathname === "/" || pathname === "/flights";
}

function AuthenticatedHeader({ authReady }) {
  if (!authReady) {
    return <SignedOutHeader disabled />;
  }

  return <LiveAuthHeader />;
}

function PrimaryNav({ authReady }) {
  if (!authReady) {
    return <PublicPrimaryNav />;
  }

  return <LivePrimaryNav />;
}

function PublicPrimaryNav() {
  return (
    <nav className="header-nav" aria-label="Primary navigation">
      <a href="/flights#search">Search</a>
      <a href="/flights#deals">Deals</a>
      <a href="/flights#faq">FAQ</a>
    </nav>
  );
}

function LivePrimaryNav() {
  const { isSignedIn } = useAsgardeo();

  if (isSignedIn) {
    return <span aria-hidden="true" />;
  }

  return <PublicPrimaryNav />;
}

function LiveAuthHeader() {
  const { isSignedIn, isLoading, signIn, signOut, user } = useAsgardeo();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const firstName = user?.name?.givenName || "";
  const lastName = user?.name?.familyName || "";
  const fullName = `${firstName} ${lastName}`.trim();
  const email = user?.email || user?.mail || user?.username || user?.userName || "";
  const displayName = fullName || email || user?.sub || "";
  const isUserResolving = isSignedIn && (!user || !displayName);

  useEffect(() => {
    function handlePointerDown(event) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setIsAccountMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  if (isUserResolving) {
    return (
      <div className="auth-cluster">
        <div className="user-chip user-chip--loading" role="status" aria-live="polite">
          <span className="user-chip-spinner" aria-hidden="true" />
          <span className="user-chip-name">Loading account...</span>
        </div>
      </div>
    );
  }

  if (isSignedIn) {
    return (
      <div className="auth-cluster account-menu-wrap" ref={accountMenuRef}>
        <button
          className="user-chip"
          type="button"
          aria-expanded={isAccountMenuOpen}
          aria-haspopup="menu"
          onClick={() => setIsAccountMenuOpen((current) => !current)}
        >
          <CircleUserRound className="user-chip-avatar" size={28} />
          <span className="user-chip-text">
            <span className="user-chip-name">{displayName}</span>
            {fullName && email && <span className="user-chip-email">{email}</span>}
          </span>
          <ChevronDown
            className={`user-chip-chevron ${isAccountMenuOpen ? "user-chip-chevron--open" : ""}`}
            size={18}
          />
        </button>
        {isAccountMenuOpen && (
          <div className="account-menu" role="menu">
            <Link className="account-menu-item" to="/profile" role="menuitem">
              <CircleUserRound size={18} />
              <span>Profile</span>
            </Link>
            <Link className="account-menu-item" to="/bookings" role="menuitem">
              <CircleUserRound size={18} />
              <span>My Bookings</span>
            </Link>
            <button
              className="account-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                clearCDSCookies();
                signOut();
              }}
            >
              <LogOut size={18} />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="auth-cluster">
      <button
        className="text-button"
        type="button"
        disabled={isLoading}
        onClick={async () => {
          const signInConfig = await createSignInConfigWithCDSTracker();
          signIn(signInConfig);
        }}
      >
        Sign in
      </button>
      <a className="primary-small" href={SIGN_UP_URL}>
        Sign up
      </a>
    </div>
  );
}

function SignedOutHeader({ disabled }) {
  return (
    <div className="auth-cluster">
      <button className="text-button" type="button" disabled={disabled}>
        Sign in
      </button>
      <button className="primary-small" type="button" disabled={disabled}>
        Sign up
      </button>
    </div>
  );
}

function FooterLinks({ authReady }) {
  if (!authReady) {
    return <PublicFooterLinks />;
  }

  return <LiveFooterLinks />;
}

function PublicFooterLinks() {
  return (
    <nav className="footer-links" aria-label="Footer navigation">
      <a href="/flights#search">Search</a>
      <a href="/flights#deals">Deals</a>
      <a href="/flights#faq">FAQ</a>
    </nav>
  );
}

function LiveFooterLinks() {
  const { isSignedIn } = useAsgardeo();

  if (isSignedIn) {
    return null;
  }

  return <PublicFooterLinks />;
}

function SiteFooter({ authReady }) {
  return (
    <footer className="site-footer">
      <div>
        <Link className="brand footer-brand" to="/flights" aria-label="Wayfinder Travel home">
          <span className="brand-mark">
            <BrandLogo />
          </span>
          <span>Wayfinder</span>
        </Link>
        <p>Modern travel booking flows, secured with Asgardeo.</p>
      </div>
      <FooterLinks authReady={authReady} />
    </footer>
  );
}

function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [messages, setMessages] = useState([
    createChatMessage("assistant", "Hi, I can help with travel questions and booking details.")
  ]);
  const [dealAlertRequest, setDealAlertRequest] = useState(null);
  const [dealAlertCriteria, setDealAlertCriteria] = useState(DEFAULT_DEAL_ALERT_CRITERIA);
  const [draft, setDraft] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const socketRef = useRef(null);
  const queuedAgentMessageRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setIsProcessing(false);
      setConnectionStatus("disconnected");
      return undefined;
    }

    let isCurrent = true;
    let retryDelay = 700;

    function connect() {
      if (!isCurrent) {
        return;
      }

      setConnectionStatus("connecting");
      const socket = new WebSocket(AGENT_CHAT_URL);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (!isCurrent) {
          return;
        }

        retryDelay = 700;
        setConnectionStatus("connected");

        if (queuedAgentMessageRef.current) {
          const queuedMessage = queuedAgentMessageRef.current;
          queuedAgentMessageRef.current = null;
          socket.send(JSON.stringify({ message: queuedMessage }));
        }
      });

      socket.addEventListener("message", (event) => {
        if (!isCurrent) {
          return;
        }

        let payload;

        try {
          payload = JSON.parse(event.data);
        } catch {
          payload = { type: "message", message: event.data };
        }

        if (payload.type === "message" || payload.type === "response") {
          setMessages((current) => [
            ...current,
            createChatMessage("assistant", payload.message || "")
          ]);
          setIsProcessing(false);
        } else if (payload.type === "authorization_required") {
          setMessages((current) => [
            ...current,
            createChatMessage("assistant", payload.message || "Authorize this action to continue.", {
              authorizeUrl: payload.authorizeUrl || ""
            })
          ]);
          setIsProcessing(false);
        } else if (payload.type === "error") {
          setMessages((current) => [
            ...current,
            createChatMessage("assistant", payload.message || "I could not process that request.")
          ]);
          setIsProcessing(false);
        }
      });

      socket.addEventListener("close", () => {
        if (!isCurrent) {
          return;
        }

        setConnectionStatus("disconnected");
        socketRef.current = null;
        reconnectTimerRef.current = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 1.6, 4000);
      });

      socket.addEventListener("error", () => {
        if (!isCurrent) {
          return;
        }

        setConnectionStatus("disconnected");
      });
    }

    connect();

    return () => {
      isCurrent = false;
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;

      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [isOpen, messages]);

  useEffect(() => {
    function handleDealAlertConsent(event) {
      const request = event.detail;

      if (!request?.bookingId || !request?.username || !request?.routeFrom || !request?.routeTo) {
        return;
      }

      const defaultMaxStops = Number.isInteger(request.currentStops) ? request.currentStops : null;

      setDealAlertRequest(request);
      setDealAlertCriteria({
        ...DEFAULT_DEAL_ALERT_CRITERIA,
        maxStops: defaultMaxStops
      });
      setIsOpen(true);
      setMessages((current) => [
        ...current,
        createChatMessage(
          "assistant",
          `Want me to watch for a better deal for ${request.routeFrom} to ${request.routeTo}? Pick the criteria I should use.`
        )
      ]);
    }

    window.addEventListener("wayfinder:deal-alert-consent", handleDealAlertConsent);

    return () => {
      window.removeEventListener("wayfinder:deal-alert-consent", handleDealAlertConsent);
    };
  }, []);

  function sendAgentMessage(message, displayContent = message) {
    setMessages((current) => [...current, createChatMessage("user", displayContent)]);
    setDraft("");
    setIsProcessing(true);

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ message }));
      return;
    }

    queuedAgentMessageRef.current = message;
    setIsOpen(true);
  }

  function handleDealAlertChoice(enabled) {
    if (!dealAlertRequest || isProcessing) {
      return;
    }

    const request = dealAlertRequest;
    const criteria = enabled ? dealAlertCriteria : {};
    setDealAlertRequest(null);
    sendAgentMessage(
      [
        "Store offline better-deal alert consent for this flight booking.",
        `bookingId: ${request.bookingId}`,
        `username: ${request.username}`,
        `routeFrom: ${request.routeFrom}`,
        `routeTo: ${request.routeTo}`,
        `criteria: ${JSON.stringify(criteria)}`,
        `minimumSavingsPercent: ${criteria.minimumSavingsPercent ?? ""}`,
        `maxStops: ${criteria.maxStops ?? ""}`,
        `timePreference: ${criteria.timePreference ?? ""}`,
        `sameCabinOnly: ${criteria.sameCabinOnly ?? ""}`,
        `enabled: ${enabled}`,
      ].join("\n"),
      enabled ? "Watch for better deals with these criteria." : "No, do not send better-deal alerts."
    );
  }

  function updateDealAlertCriteria(updates) {
    setDealAlertCriteria((current) => ({
      ...current,
      ...updates
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    const message = draft.trim();

    if (!message || isProcessing) {
      return;
    }

    sendAgentMessage(message);
  }

  return (
    <div className="chat-widget">
      {isOpen && (
        <section className="chat-panel" aria-label="AI travel assistant">
          <header className="chat-header">
            <div>
              <span className="chat-kicker">AI assistant</span>
              <h2>Wayfinder concierge</h2>
            </div>
            <div className="chat-header-actions">
              <span className={`chat-status chat-status--${connectionStatus}`}>
                {connectionStatus}
              </span>
              <button
                className="chat-icon-button"
                type="button"
                aria-label="Close AI chat"
                onClick={() => setIsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
          </header>
          <div className="chat-messages" role="log" aria-live="polite">
            {messages.map((message) => (
              <div className={`chat-message chat-message--${message.role}`} key={message.id}>
                <span>{message.content}</span>
                {message.authorizeUrl && (
                  <a
                    className="chat-authorization-link"
                    href={message.authorizeUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ShieldCheck size={16} />
                    <span>Open consent page</span>
                  </a>
                )}
              </div>
            ))}
            {dealAlertRequest && (
              <div className="chat-criteria-card" aria-label="Better-deal alert criteria">
                <label className="chat-criteria-field">
                  <span>Minimum savings</span>
                  <select
                    value={dealAlertCriteria.minimumSavingsPercent}
                    onChange={(event) => updateDealAlertCriteria({
                      minimumSavingsPercent: Number(event.target.value)
                    })}
                  >
                    <option value={5}>5% or more</option>
                    <option value={10}>10% or more</option>
                    <option value={15}>15% or more</option>
                    <option value={20}>20% or more</option>
                  </select>
                </label>
                <label className="chat-criteria-field">
                  <span>Maximum stops</span>
                  <select
                    value={dealAlertCriteria.maxStops ?? "any"}
                    onChange={(event) => updateDealAlertCriteria({
                      maxStops: event.target.value === "any" ? null : Number(event.target.value)
                    })}
                  >
                    <option value="any">Any</option>
                    <option value={0}>Nonstop only</option>
                    <option value={1}>Up to 1 stop</option>
                    <option value={2}>Up to 2 stops</option>
                  </select>
                </label>
                <label className="chat-criteria-field">
                  <span>Travel time</span>
                  <select
                    value={dealAlertCriteria.timePreference}
                    onChange={(event) => updateDealAlertCriteria({
                      timePreference: event.target.value
                    })}
                  >
                    <option value="any">Any time</option>
                    <option value="earlier">Earlier same day</option>
                    <option value="later">Later same day</option>
                  </select>
                </label>
                <label className="chat-criteria-toggle">
                  <input
                    type="checkbox"
                    checked={dealAlertCriteria.sameCabinOnly}
                    onChange={(event) => updateDealAlertCriteria({
                      sameCabinOnly: event.target.checked
                    })}
                  />
                  <span>Keep the same cabin</span>
                </label>
                <div className="chat-choice-row">
                  <button
                    className="chat-choice-button chat-choice-button--primary"
                    type="button"
                    disabled={isProcessing}
                    onClick={() => handleDealAlertChoice(true)}
                  >
                    Save alerts
                  </button>
                  <button
                    className="chat-choice-button chat-choice-button--secondary"
                    type="button"
                    disabled={isProcessing}
                    onClick={() => handleDealAlertChoice(false)}
                  >
                    No thanks
                  </button>
                </div>
              </div>
            )}
            {isProcessing && (
              <div className="chat-message chat-message--assistant chat-message--typing">
                Thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <form className="chat-composer" onSubmit={handleSubmit}>
            <label className="chat-input-label">
              <span>Ask the travel assistant</span>
              <input
                value={draft}
                placeholder="Ask about flights or bookings"
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <button
              className="chat-send-button"
              type="submit"
              disabled={!draft.trim() || isProcessing}
              aria-label="Send message"
            >
              <Send size={18} />
            </button>
          </form>
        </section>
      )}

      <button
        className="chat-launcher"
        type="button"
        aria-label={isOpen ? "Close AI chat" : "Open AI chat"}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        {isOpen ? <X size={22} /> : <MessageCircle size={24} />}
      </button>
    </div>
  );
}

function FlightDetailsRoute({ auth, criteria }) {
  const { flightId = "" } = useParams();

  return <FlightDetailsPage auth={auth} criteria={criteria} flightId={flightId} />;
}

function LiveFlightDetailsRoute({ criteria }) {
  const auth = useApiAuth();

  return <FlightDetailsRoute auth={auth} criteria={criteria} />;
}

function PaymentRoute({ criteria }) {
  const { flightId = "" } = useParams();

  return <PaymentPageWithAuth criteria={criteria} flightId={flightId} />;
}

function BookingDetailsRoute() {
  const { bookingId = "" } = useParams();

  return <BookingDetailsPageWithAuth bookingId={bookingId} />;
}

function LandingRoute({ authReady, category, cdsProfileId, locations, onSearch }) {
  if (authReady) {
    return (
      <SignedInHomePage
        category={category}
        cdsProfileId={cdsProfileId}
        locations={locations}
        onSearch={onSearch}
      />
    );
  }

  return <HomePage category={category} locations={locations} onSearch={onSearch} />;
}

function LiveCDSProfileBootstrap({ cdsProfileId, onProfileCreated }) {
  const { isLoading, isSignedIn } = useAsgardeo();
  const location = useLocation();

  useEffect(() => {
    if (!isFlightLandingPath(location.pathname) || location.hash || cdsProfileId) {
      return;
    }

    if (isLoading || isSignedIn) {
      return;
    }

    let isCurrent = true;

    async function createCDSProfileOnMount() {
      try {
        const profile = await ensureCDSProfile({});
        const createdProfileId = profile?.profile_id || profile?.id;

        if (isCurrent && createdProfileId) {
          onProfileCreated(createdProfileId);
        }
      } catch (error) {
        console.warn("Failed to create CDS profile:", error.message);
      }
    }

    createCDSProfileOnMount();

    return () => {
      isCurrent = false;
    };
  }, [cdsProfileId, isLoading, isSignedIn, location.hash, location.pathname, onProfileCreated]);

  return null;
}

function GuestCDSProfileBootstrap({ cdsProfileId, onProfileCreated }) {
  const location = useLocation();

  useEffect(() => {
    if (!isFlightLandingPath(location.pathname) || location.hash || cdsProfileId) {
      return;
    }

    let isCurrent = true;

    async function createCDSProfileOnMount() {
      try {
        const profile = await ensureCDSProfile({});
        const createdProfileId = profile?.profile_id || profile?.id;

        if (isCurrent && createdProfileId) {
          onProfileCreated(createdProfileId);
        }
      } catch (error) {
        console.warn("Failed to create CDS profile:", error.message);
      }
    }

    createCDSProfileOnMount();

    return () => {
      isCurrent = false;
    };
  }, [cdsProfileId, location.hash, location.pathname, onProfileCreated]);

  return null;
}

function getFallbackLocations() {
  return {
    flights: [
      { name: "Colombo", type: "city" },
      { name: "Singapore", type: "city" },
      { name: "Tokyo", type: "city" },
      { name: "London", type: "city" },
      { name: "Dubai", type: "city" }
    ],
    hotels: [
      { name: "Singapore Marina", type: "area" },
      { name: "Tokyo Shibuya", type: "area" },
      { name: "London Kings Cross", type: "area" }
    ],
    trips: [
      { name: "Singapore", type: "destination" },
      { name: "Tokyo", type: "destination" },
      { name: "Dubai", type: "destination" }
    ]
  };
}

function LocationsLoader({ auth, isReady = true, onLocationsLoaded }) {
  const flightLocationsQuery = useLocationQuery("flights", {
    auth,
    enabled: isReady
  });
  const hotelLocationsQuery = useLocationQuery("hotels", {
    auth,
    enabled: isReady
  });
  const tripLocationsQuery = useLocationQuery("trips", {
    auth,
    enabled: isReady
  });

  useEffect(() => {
    if (!isReady || flightLocationsQuery.isLoading) {
      return;
    }

    const fallbackLocations = getFallbackLocations();
    const nextLocations = {
      flights: flightLocationsQuery.data || fallbackLocations.flights,
      hotels: hotelLocationsQuery.data || fallbackLocations.hotels,
      trips: tripLocationsQuery.data || fallbackLocations.trips
    };

    onLocationsLoaded(nextLocations);
  }, [
    flightLocationsQuery.data,
    flightLocationsQuery.isLoading,
    hotelLocationsQuery.data,
    isReady,
    onLocationsLoaded,
    tripLocationsQuery.data
  ]);

  return null;
}

function LiveLocationsLoader({ onLocationsLoaded }) {
  const auth = useApiAuth();

  return (
    <LocationsLoader
      auth={auth}
      isReady={!auth.isLoading}
      onLocationsLoaded={onLocationsLoaded}
    />
  );
}

function PublicLocationsLoader({ onLocationsLoaded }) {
  return (
    <LocationsLoader
      onLocationsLoaded={onLocationsLoaded}
    />
  );
}

function AppRoutes({ authReady, cdsProfileId, criteria, locations, onSearch }) {
  const flightLandingElement = (
    <LandingRoute
      authReady={authReady}
      category="flights"
      cdsProfileId={cdsProfileId}
      locations={locations}
      onSearch={onSearch}
    />
  );

  return (
    <Routes>
      <Route path="/" element={flightLandingElement} />
      <Route path="/flights" element={flightLandingElement} />
      <Route
        path="/hotels"
        element={
          <LandingRoute
            authReady={authReady}
            category="hotels"
            cdsProfileId={cdsProfileId}
            locations={locations}
            onSearch={onSearch}
          />
        }
      />
      <Route
        path="/trips"
        element={
          <LandingRoute
            authReady={authReady}
            category="trips"
            cdsProfileId={cdsProfileId}
            locations={locations}
            onSearch={onSearch}
          />
        }
      />
      <Route
        path="/results"
        element={
          authReady ? (
            <ResultsPageWithAuth
              cdsProfileId={cdsProfileId}
              criteria={criteria}
              locations={locations}
              onSearch={onSearch}
            />
          ) : (
            <ResultsPage
              cdsProfileId={cdsProfileId}
              criteria={criteria}
              locations={locations}
              onSearch={onSearch}
            />
          )
        }
      />
      <Route
        path="/flights/:flightId"
        element={
          authReady ? (
            <LiveFlightDetailsRoute criteria={criteria} />
          ) : (
            <FlightDetailsRoute criteria={criteria} />
          )
        }
      />
      <Route
        path="/payment/flight/:flightId"
        element={authReady ? <PaymentRoute criteria={criteria} /> : <BookingsUnavailable />}
      />
      <Route
        path="/bookings/:bookingId"
        element={authReady ? <BookingDetailsRoute /> : <BookingsUnavailable />}
      />
      <Route
        path="/bookings"
        element={authReady ? <BookingsPageWithAuth /> : <BookingsUnavailable />}
      />
      <Route
        path="/profile"
        element={authReady ? <ProfilePageWithAuth /> : <BookingsUnavailable />}
      />
      <Route path="*" element={<Navigate to="/flights" replace />} />
    </Routes>
  );
}

function App({ authReady }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [cdsProfileId, setCdsProfileId] = useState(() => initializeCDSFromCookie() || null);
  const [locations, setLocations] = useState({
    flights: [],
    hotels: [],
    trips: []
  });

  function handleSearch(searchParams) {
    navigate(buildResultsPath(searchParams));
  }

  const criteria = readCriteria(location.search);

  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" to="/flights" aria-label="Wayfinder Travel home">
          <span className="brand-mark">
            <BrandLogo />
          </span>
          <span>Wayfinder</span>
        </Link>
        <PrimaryNav authReady={authReady} />
        <AuthenticatedHeader authReady={authReady} />
      </header>

      {!authReady && (
        <div className="setup-banner" role="status">
          <ShieldCheck size={18} />
          Add `VITE_ASGARDEO_CLIENT_ID` and `VITE_ASGARDEO_BASE_URL` to enable live
          Asgardeo sign in, sign up, and sign out.
        </div>
      )}

      {authReady ? (
        <>
          <LiveLocationsLoader onLocationsLoaded={setLocations} />
          <LiveCDSProfileBootstrap cdsProfileId={cdsProfileId} onProfileCreated={setCdsProfileId} />
        </>
      ) : (
        <>
          <PublicLocationsLoader onLocationsLoaded={setLocations} />
          <GuestCDSProfileBootstrap cdsProfileId={cdsProfileId} onProfileCreated={setCdsProfileId} />
        </>
      )}

      <AppRoutes
        authReady={authReady}
        cdsProfileId={cdsProfileId}
        criteria={criteria}
        locations={locations}
        onSearch={handleSearch}
      />
      <ChatWidget />
      <SiteFooter authReady={authReady} />
    </div>
  );
}

export default App;
