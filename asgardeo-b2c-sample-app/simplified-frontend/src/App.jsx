import { useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  Send,
  X
} from "lucide-react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { useLocationQuery } from "./api-queries";
import { Header } from "./components/Header";
import { BookingDetailsPageWithAuth } from "./pages/BookingDetailsPageWithAuth";
import { BookingsPageWithAuth } from "./pages/BookingsPageWithAuth";
import { FlightDetailsPage } from "./pages/FlightDetailsPage";
import { HomePage } from "./pages/HomePage";
import { PaymentPageWithAuth } from "./pages/PaymentPageWithAuth";
import { ProfilePageWithAuth } from "./pages/ProfilePageWithAuth";
import { ResultsPage } from "./pages/ResultsPage";
import { buildResultsPath, readCriteria } from "./utils/routes";
import wayfinderLogo from "./assets/wayfinder-logo.png";

const AGENT_CHAT_URL = import.meta.env.VITE_AGENT_CHAT_URL || "ws://localhost:8790/chat";

function createChatMessage(role, content) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content
  };
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <Link className="brand footer-brand" to="/flights" aria-label="Wayfinder Travel home">
          <span className="brand-mark">
            <img className="brand-logo" src={wayfinderLogo} alt="Wayfinder Travel logo" />
          </span>
          <span>Wayfinder</span>
        </Link>
        <p>Modern travel booking flows.</p>
      </div>
      <nav className="footer-links" aria-label="Footer navigation">
        <a href="/flights#search">Search</a>
        <a href="/flights#deals">Deals</a>
        <a href="/flights#faq">FAQ</a>
      </nav>
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
  const [dealAlertCriteria, setDealAlertCriteria] = useState({
    minimumSavingsPercent: 10,
    maxStops: null,
    timePreference: "any",
    sameCabinOnly: true
  });
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

      if (!request?.bookingId || !request?.routeFrom || !request?.routeTo) {
        return;
      }

      const defaultMaxStops = Number.isInteger(request.currentStops) ? request.currentStops : null;

      setDealAlertRequest(request);
      setDealAlertCriteria((current) => ({
        ...current,
        maxStops: defaultMaxStops
      }));
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
                {message.content}
              </div>
            ))}
            {dealAlertRequest && (
              <div className="chat-criteria-card" aria-label="Better-deal alert criteria">
                <label className="chat-criteria-field">
                  <span>Minimum savings</span>
                  <select
                    value={dealAlertCriteria.minimumSavingsPercent}
                    onChange={(event) => setDealAlertCriteria((c) => ({
                      ...c,
                      minimumSavingsPercent: Number(event.target.value)
                    }))}
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
                    onChange={(event) => setDealAlertCriteria((c) => ({
                      ...c,
                      maxStops: event.target.value === "any" ? null : Number(event.target.value)
                    }))}
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
                    onChange={(event) => setDealAlertCriteria((c) => ({
                      ...c,
                      timePreference: event.target.value
                    }))}
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
                    onChange={(event) => setDealAlertCriteria((c) => ({
                      ...c,
                      sameCabinOnly: event.target.checked
                    }))}
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

function FlightDetailsRoute({ criteria }) {
  const { flightId = "" } = useParams();

  return <FlightDetailsPage criteria={criteria} flightId={flightId} />;
}

function PaymentRoute({ criteria }) {
  const { flightId = "" } = useParams();

  return <PaymentPageWithAuth criteria={criteria} flightId={flightId} />;
}

function BookingDetailsRoute() {
  const { bookingId = "" } = useParams();

  return <BookingDetailsPageWithAuth bookingId={bookingId} />;
}

function LocationsLoader({ onLocationsLoaded }) {
  const flightLocationsQuery = useLocationQuery("flights");
  const hotelLocationsQuery = useLocationQuery("hotels");
  const tripLocationsQuery = useLocationQuery("trips");

  useEffect(() => {
    if (flightLocationsQuery.isLoading) {
      return;
    }

    const fallback = {
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

    onLocationsLoaded({
      flights: flightLocationsQuery.data || fallback.flights,
      hotels: hotelLocationsQuery.data || fallback.hotels,
      trips: tripLocationsQuery.data || fallback.trips
    });
  }, [
    flightLocationsQuery.data,
    flightLocationsQuery.isLoading,
    hotelLocationsQuery.data,
    onLocationsLoaded,
    tripLocationsQuery.data
  ]);

  return null;
}

function AppRoutes({ criteria, locations, onSearch }) {
  const landingElement = (category) => (
    <HomePage
      category={category}
      locations={locations}
      onSearch={onSearch}
    />
  );

  return (
    <Routes>
      <Route path="/" element={landingElement("flights")} />
      <Route path="/flights" element={landingElement("flights")} />
      <Route path="/hotels" element={landingElement("hotels")} />
      <Route path="/trips" element={landingElement("trips")} />
      <Route
        path="/results"
        element={
          <ResultsPage
            criteria={criteria}
            locations={locations}
            onSearch={onSearch}
          />
        }
      />
      <Route path="/flights/:flightId" element={<FlightDetailsRoute criteria={criteria} />} />
      <Route path="/payment/flight/:flightId" element={<PaymentRoute criteria={criteria} />} />
      <Route path="/bookings/:bookingId" element={<BookingDetailsRoute />} />
      <Route path="/bookings" element={<BookingsPageWithAuth />} />
      <Route path="/profile" element={<ProfilePageWithAuth />} />
      <Route path="*" element={<Navigate to="/flights" replace />} />
    </Routes>
  );
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
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
      <Header />

      <LocationsLoader onLocationsLoaded={setLocations} />

      <AppRoutes
        criteria={criteria}
        locations={locations}
        onSearch={handleSearch}
      />
      <ChatWidget />
      <SiteFooter />
    </div>
  );
}

export default App;
