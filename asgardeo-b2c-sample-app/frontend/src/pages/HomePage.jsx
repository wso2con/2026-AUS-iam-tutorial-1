import { useEffect, useState } from "react";
import { useAsgardeo } from "@asgardeo/react";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Clock3,
  Hotel,
  LifeBuoy,
  Plane,
  Search,
  ShieldCheck,
  Sparkles,
  Star
} from "lucide-react";
import { apiQueryKeys, useApiAuth } from "../api-queries";
import { getFlight } from "../api";
import { SearchPanel } from "../components/SearchPanel";
import { ASGARDEO_CLIENT_ID, getCDSProfile } from "../cds-api";
import { buildFlightDetailsPath } from "../utils/routes";

function extractFavoriteFlightIds(profile) {
  const normalizedProfile = profile?.data || profile?.profile || profile || {};
  const applicationData = normalizedProfile?.application_data || normalizedProfile?.applicationData || {};
  const appScopedFavorites = applicationData?.[ASGARDEO_CLIENT_ID]?.fav_flights;

  if (Array.isArray(appScopedFavorites)) {
    return appScopedFavorites.map((id) => `${id}`);
  }

  for (const appData of Object.values(applicationData)) {
    if (Array.isArray(appData?.fav_flights)) {
      return appData.fav_flights.map((id) => `${id}`);
    }
  }

  return [];
}

function QuickBookingButton({ onClick }) {
  return (
    <button
      className="card-action"
      type="button"
      onClick={onClick}
    >
      Book flight
    </button>
  );
}

function LoadingFavorites() {
  return (
    <div className="empty-state results-loading" role="status" aria-live="polite">
      <Plane className="results-loading__icon" size={24} aria-hidden="true" />
      <span>Loading favorite flights...</span>
    </div>
  );
}

function QuickBookingsSection({ cdsProfileId }) {
  const navigate = useNavigate();
  const auth = useApiAuth();
  const [favoriteFlightIds, setFavoriteFlightIds] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isCurrent = true;

    async function loadFavorites() {
      if (!cdsProfileId) {
        if (isCurrent) {
          setFavoriteFlightIds([]);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError("");

      try {
        const profile = await getCDSProfile(cdsProfileId);
        const favoriteIds = extractFavoriteFlightIds(profile);

        if (isCurrent) {
          setFavoriteFlightIds(favoriteIds);
        }
      } catch (requestError) {
        if (isCurrent) {
          setFavoriteFlightIds([]);
          setError(requestError.message);
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    loadFavorites();

    return () => {
      isCurrent = false;
    };
  }, [cdsProfileId]);

  const favoriteFlightQueries = useQueries({
    queries: favoriteFlightIds.map((id) => ({
      queryKey: apiQueryKeys.flight(id, auth.userKey),
      queryFn: () => getFlight(id, auth),
      enabled: auth.isSignedIn && !auth.isLoading,
      retry: false
    }))
  });
  const isFavoriteFlightLoading = favoriteFlightQueries.some((query) => query.isLoading);
  const favoriteFlights = favoriteFlightQueries
    .map((query) => query.data)
    .filter(Boolean);

  function handleBooking(itemId) {
    setError("");
    navigate(buildFlightDetailsPath(itemId));
  }

  return (
    <section className="content-band quick-bookings-section" aria-label="Quick bookings from CDS favorites">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Quick bookings</p>
          <h2>Your favorite flights</h2>
        </div>
      </div>

      {error && (
        <div className="api-status api-status--error" role="status">
          {error}
        </div>
      )}

      {isLoading || isFavoriteFlightLoading ? (
        <LoadingFavorites />
      ) : favoriteFlights.length === 0 ? (
        <p className="empty-state">No favorite flights found yet. Mark favorites in search results.</p>
      ) : (
        <div className="quick-bookings-grid">
          {favoriteFlights.map((flight) => (
            <article className="result-card" key={flight.id}>
              <div>
                <p className="result-label">
                  {flight.airline} · {flight.stops === 0 ? "Nonstop" : `${flight.stops} stop`}
                </p>
                <h2>{flight.from} to {flight.to}</h2>
                <p>
                  {flight.departureTime} - {flight.arrivalTime} · {flight.duration} · {flight.dates}
                </p>
              </div>
              <div className="result-side">
                <strong>{flight.currency === "USD" ? "$" : `${flight.currency} `}{flight.price}</strong>
                <span>{flight.cabin}</span>
                <QuickBookingButton onClick={() => handleBooking(flight.id)} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const pageDetails = {
  flights: {
    heroHeading: "Find flights for wherever you are headed.",
    heroCopy:
      "Compare fares, departure times, stops, and routes before turning the best option into a managed booking.",
    freshPicksHeading: "Flight ideas for your next window of free time.",
    whyTitle: "A cleaner path from route search to booking.",
    whyCopy:
      "Keep route ideas, dates, traveler counts, booking details, and deal alerts in one focused travel flow.",
    highlights: [
      {
        icon: <Sparkles size={22} />,
        title: "Fare comparison",
        copy: "Scan prices, cabins, stops, and airline timing without jumping between pages."
      },
      {
        icon: <Search size={22} />,
        title: "Booking workspace",
        copy: "View confirmed trips, payment details, wallet QR codes, and cancellation options."
      },
      {
        icon: <Clock3 size={22} />,
        title: "Better-deal alerts",
        copy: "Let the assistant watch booked routes and ask before applying a lower fare."
      }
    ],
    deals: [
      {
        className: "deal-card--mint",
        icon: <Plane size={22} />,
        route: "New York to Los Angeles",
        title: "Nonstop coast-to-coast with flexible booking",
        price: "$268",
        meta: "Jun 12 - Jun 18"
      },
      {
        className: "deal-card--coral",
        icon: <Plane size={22} />,
        route: "Chicago to Miami",
        title: "Quick escape to warm beaches and sunny skies",
        price: "$245",
        meta: "Economy round trip"
      },
      {
        className: "deal-card--gold",
        icon: <Plane size={22} />,
        route: "Denver to Las Vegas",
        title: "Short hop with budget-friendly rates and great value",
        price: "$132",
        meta: "Best value this week"
      }
    ]
  },
  hotels: {
    heroHeading: "Find stays that fit the way you travel.",
    heroCopy:
      "Compare areas, nightly rates, and useful amenities before choosing the stay that keeps your trip simple.",
    freshPicksHeading: "Stay ideas close to food, rail, and plans.",
    whyTitle: "A cleaner path from area search to reservation.",
    whyCopy:
      "Keep destinations, dates, guest counts, nightly rates, and amenities in one focused search flow.",
    highlights: [
      {
        icon: <Hotel size={22} />,
        title: "Area-first search",
        copy: "Start from the neighborhood or district that fits the trip."
      },
      {
        icon: <Star size={22} />,
        title: "Amenity matching",
        copy: "Compare breakfast, pool, workspace, shuttle, and location details at a glance."
      },
      {
        icon: <Clock3 size={22} />,
        title: "Clear rate signals",
        copy: "Nightly prices, ratings, and dates stay easy to scan before reserving."
      }
    ],
    deals: [
      {
        className: "deal-card--mint",
        icon: <Hotel size={22} />,
        route: "Los Angeles Marina",
        title: "Beachfront stays with pools and gym access",
        price: "$148",
        meta: "Average nightly rate"
      },
      {
        className: "deal-card--coral",
        icon: <Hotel size={22} />,
        route: "Miami Beach",
        title: "Ocean view hotels with spa and restaurant nearby",
        price: "$156",
        meta: "Guest favorite area"
      },
      {
        className: "deal-card--gold",
        icon: <Hotel size={22} />,
        route: "San Francisco Union Square",
        title: "Shopping district with great dining and workout rooms",
        price: "$174",
        meta: "Central location"
      }
    ]
  },
  trips: {
    heroHeading: "Find trip ideas when the destination is still forming.",
    heroCopy:
      "Explore city plans, estimated budgets, and flexible destination ideas before turning curiosity into a booking.",
    freshPicksHeading: "Trip ideas with enough structure to start.",
    whyTitle: "A cleaner path from inspiration to itinerary.",
    whyCopy:
      "Keep destinations, estimates, and plan types together so comparing possible trips feels lighter.",
    highlights: [
      {
        icon: <Sparkles size={22} />,
        title: "Curated ideas",
        copy: "Compare ready-to-shape city plans while the destination is still flexible."
      },
      {
        icon: <Star size={22} />,
        title: "Budget signals",
        copy: "Estimated totals keep flight, hotel, and planning tradeoffs grounded."
      },
      {
        icon: <LifeBuoy size={22} />,
        title: "Assistant support",
        copy: "Ask for travel help, booking details, and route-specific deal monitoring."
      }
    ],
    deals: [
      {
        className: "deal-card--mint",
        icon: <Sparkles size={22} />,
        route: "Los Angeles highlights",
        title: "A beach, culture, and coastal plan for a long weekend",
        price: "$966",
        meta: "Estimated trip total"
      },
      {
        className: "deal-card--coral",
        icon: <Sparkles size={22} />,
        route: "Chicago highlights",
        title: "A practical city plan with museums and great food",
        price: "$524",
        meta: "Five-day estimate"
      },
      {
        className: "deal-card--gold",
        icon: <Sparkles size={22} />,
        route: "Miami highlights",
        title: "A polished three-day beach and nightlife plan",
        price: "$924",
        meta: "Estimated trip total"
      }
    ]
  }
};

export function HomePage({
  category = "flights",
  hideHeroSupport = false,
  heroHeading,
  locations,
  onSearch,
  quickBookings
}) {
  const details = pageDetails[category] || pageDetails.flights;
  const isGreetingHero = hideHeroSupport;

  const faqs = [
    {
      question: "How does Wayfinder work?",
      answer: "Wayfinder helps you search sample flights, hotels, and trip ideas in one place. You can compare routes, prices, dates, and amenities, then sign in to create and manage bookings in the app."
    },
    {
      question: "How can I find a better flight option?",
      answer: "Start with your origin, destination, travel dates, and traveler count. Wayfinder shows matching flights with fares, timing, stops, cabin, and useful tags so you can choose the option that fits the trip."
    },
    {
      question: "Can Wayfinder help when I do not know where to go?",
      answer: "Yes. The Trips view shows destination ideas with estimated totals and planning context, so you can compare possible trips before choosing a flight or hotel."
    },
    {
      question: "Can I book inside Wayfinder?",
      answer: "Yes. After signing in, you can confirm sample flight, hotel, or trip bookings directly in the app and view them later from My Bookings."
    },
    {
      question: "What can I do after I book a flight?",
      answer: "You can view the booking details, add the booking to a wallet using the displayed QR code, cancel the booking, and optionally let the AI assistant watch for better deals on the same route."
    },
    {
      question: "Does Wayfinder support hotels too?",
      answer: "Yes. You can search hotels by destination area and compare nightly rates, ratings, and amenities before reserving a stay."
    },
    {
      question: "What can the AI assistant do?",
      answer: "The assistant can answer travel questions, look up available options through the travel tools, store your better-deal alert preference, and help trigger a consent-based better-deal update."
    },
    {
      question: "What are better-deal alerts?",
      answer: "After booking a flight, you can ask Wayfinder to watch for better deals on the same route. If a better deal is found, the assistant requests your consent before applying the update."
    }
  ];

  return (
    <main>
      <section className={`hero ${isGreetingHero ? "hero--greeting" : ""}`} id="search">
        <div className="hero-copy">
          <h1>{heroHeading || details.heroHeading}</h1>
          {!hideHeroSupport && (
            <>
              <p>{details.heroCopy}</p>
              <div className="hero-actions" aria-label="Popular planning links">
                <a className="accent-button" href="#deals">
                  <Sparkles size={18} />
                  See ideas
                </a>
                <a className="link-button" href="#faq">
                  FAQ
                  <ArrowRight size={18} />
                </a>
              </div>
            </>
          )}
        </div>
        <SearchPanel
          compact
          defaultCategory={category}
          locations={locations}
          onSearch={onSearch}
        />
      </section>

      <section className="insight-strip" aria-label="Wayfinder highlights">
        {details.highlights.map((item) => (
          <div key={item.title}>
            {item.icon}
            <span>
              <strong>{item.title}</strong>
              <small>{item.copy}</small>
            </span>
          </div>
        ))}
      </section>

      {quickBookings}

      <section className="content-band" id="deals">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Fresh picks</p>
            <h2>{details.freshPicksHeading}</h2>
          </div>
          <a className="link-button" href="#search">
            Start searching
            <ArrowRight size={18} />
          </a>
        </div>
        <div className="deal-grid">
          {details.deals.map((deal) => (
            <article className={`deal-card ${deal.className}`} key={deal.title}>
              <div className="deal-icon">{deal.icon}</div>
              <p>{deal.route}</p>
              <h3>{deal.title}</h3>
              <span>{deal.meta}</span>
              <strong>{deal.price}</strong>
              <button className="card-action" type="button" onClick={() => window.location.hash = "search"}>
                Explore
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="two-column content-band">
        <div>
          <p className="eyebrow">Why Wayfinder</p>
          <h2>{details.whyTitle}</h2>
          <p className="section-copy">{details.whyCopy}</p>
          <a className="accent-button" href="#search">
            <Search size={18} />
            Plan a route
          </a>
        </div>
        <div className="stay-list">
          <article className="stay-card">
            <div>
              <h3>Managed bookings</h3>
              <p>Review confirmed flights, wallet QR codes, fare details, and cancellation actions.</p>
            </div>
            <div className="stay-meta">
              <span>
                <Plane size={18} />
              </span>
              <strong>Booked</strong>
            </div>
          </article>
          <article className="stay-card">
            <div>
              <h3>Better-deal monitoring</h3>
              <p>Opt in after booking and let the assistant watch the same route for lower fares.</p>
            </div>
            <div className="stay-meta">
              <span>
                <Clock3 size={18} />
              </span>
              <strong>Alerts</strong>
            </div>
          </article>
          <article className="stay-card">
            <div>
              <h3>Trip planning surface</h3>
              <p>Move between flights, hotels, and trip ideas without losing the search context.</p>
            </div>
            <div className="stay-meta">
              <span>
                <Sparkles size={18} />
              </span>
              <strong>Ideas</strong>
            </div>
          </article>
        </div>
      </section>

      <section className="faq-section" id="faq">
        <div className="section-heading">
          <div>
            <p className="eyebrow">FAQ</p>
            <h2>Answers before takeoff.</h2>
          </div>
        </div>
        <div className="faq-grid">
          {faqs.map((faq) => (
            <details className="faq-item" key={faq.question}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}

export function SignedInHomePage({ category = "flights", cdsProfileId, locations, onSearch }) {
  const { isSignedIn, user } = useAsgardeo();

  if (!isSignedIn) {
    return <HomePage category={category} locations={locations} onSearch={onSearch} />;
  }

  const firstName = user?.name?.givenName || "";
  const lastName = user?.name?.familyName || "";
  const fullName = `${firstName} ${lastName}`.trim();
  const email = user?.email || user?.mail || user?.username || user?.userName || "";
  const greetingName = firstName || fullName || email || "Traveler";

  return (
    <HomePage
      hideHeroSupport
      category={category}
      heroHeading={`Welcome back, ${greetingName}.`}
      quickBookings={category === "flights" ? <QuickBookingsSection cdsProfileId={cdsProfileId} /> : null}
      locations={locations}
      onSearch={onSearch}
    />
  );
}
