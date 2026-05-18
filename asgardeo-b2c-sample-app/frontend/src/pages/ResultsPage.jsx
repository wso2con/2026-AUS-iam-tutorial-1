import { useEffect, useState } from "react";
import { Heart, Plane } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  useApiAuth,
  useBookedFlightsQuery,
  useCreateBookingMutation,
  useSearchResultsQuery
} from "../api-queries";
import { SearchPanel } from "../components/SearchPanel";
import { ASGARDEO_CLIENT_ID, getCDSProfile, updateCDSProfile } from "../cds-api";
import { formatPrice, isActiveBooking, isSameFlight } from "../utils/bookings";
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

function BookingButton({ bookingState, children, onClick }) {
  const isBooking = bookingState === "booking";
  const isConfirmed = bookingState === "confirmed";

  return (
    <button
      className={`card-action ${isConfirmed ? "card-action--confirmed" : ""}`}
      type="button"
      disabled={isBooking || isConfirmed}
      onClick={onClick}
    >
      {isBooking ? "Booking..." : isConfirmed ? "Booked" : children}
    </button>
  );
}

function LoadingResults() {
  return (
    <div className="empty-state results-loading" role="status" aria-live="polite">
      <Plane className="results-loading__icon" size={24} aria-hidden="true" />
      <span>Loading results...</span>
    </div>
  );
}

function ResultCard({ bookingState, category, isFavorite, item, onBook, onSelectFlight, onToggleFavorite }) {
  if (category === "hotels") {
    return (
      <article className="result-card">
        <div>
          <p className="result-label">Hotel · Rating {item.rating}</p>
          <h2>{item.name}</h2>
          <p>{item.location}</p>
          <div className="result-tags">
            {item.amenities?.map((amenity) => (
              <span key={amenity}>{amenity}</span>
            ))}
          </div>
        </div>
        <div className="result-side">
          <strong>{formatPrice(item.currency, item.nightlyRate)}</strong>
          <span>per night</span>
          <BookingButton bookingState={bookingState} onClick={() => onBook("hotel", item.id)}>
            Reserve
          </BookingButton>
        </div>
      </article>
    );
  }

  if (category === "trips") {
    return (
      <article className="result-card">
        <div>
          <p className="result-label">Trip · {item.status}</p>
          <h2>{item.title}</h2>
          <p>{item.destination}</p>
        </div>
        <div className="result-side">
          <strong>{formatPrice(item.currency, item.totalEstimate)}</strong>
          <span>estimate</span>
          <BookingButton bookingState={bookingState} onClick={() => onBook("trip", item.id)}>
            Book trip
          </BookingButton>
        </div>
      </article>
    );
  }

  return (
    <article className="result-card">
      <div>
        <p className="result-label">
          {item.airline} · {item.stops === 0 ? "Nonstop" : `${item.stops} stop`}
        </p>
        <h2>{item.from} to {item.to}</h2>
        <p>
          {item.departureTime} - {item.arrivalTime} · {item.duration} · {item.dates}
        </p>
        <div className="result-tags">
          {item.tags?.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      <div className="result-side">
        <button
          className={`favorite-button ${isFavorite ? "favorite-button--active" : ""}`}
          type="button"
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => onToggleFavorite(item.id, item)}
        >
          <Heart size={20} />
        </button>
        <strong>{formatPrice(item.currency, item.price)}</strong>
        <span>{item.cabin}</span>
        <BookingButton bookingState={bookingState} onClick={() => onSelectFlight(item.id)}>
          Book flight
        </BookingButton>
      </div>
    </article>
  );
}

export function ResultsPage({
  auth,
  cdsProfileId,
  criteria,
  includeBookings = false,
  locations,
  onSearch
}) {
  const navigate = useNavigate();
  const [isFavoriteResultLoading, setIsFavoriteResultLoading] = useState(false);
  const [error, setError] = useState("");
  const [bookingStates, setBookingStates] = useState({});
  const [favorites, setFavorites] = useState(() => new Set());
  const resultsQuery = useSearchResultsQuery(criteria, { auth });
  const bookedFlightsQuery = useBookedFlightsQuery({
    auth,
    enabled: includeBookings && criteria.category === "flights"
  });
  const createBookingMutation = useCreateBookingMutation(auth);
  const results = resultsQuery.data || [];
  const isLoading = resultsQuery.isLoading;
  const requestError = error || resultsQuery.error?.message || "";

  useEffect(() => {
    let isCurrent = true;

    async function loadFavoritesFromCDS() {
      if (!cdsProfileId || criteria.category !== "flights") {
        if (isCurrent) {
          setFavorites(new Set());
        }
        return;
      }

      try {
        const profile = await getCDSProfile(cdsProfileId);
        const favoriteIds = extractFavoriteFlightIds(profile);

        if (isCurrent) {
          setFavorites(new Set(favoriteIds.map((id) => `${id}`)));
        }
      } catch (loadError) {
        if (isCurrent) {
          setFavorites(new Set());
        }
        console.warn("Failed to load CDS favorites:", loadError.message);
      }
    }

    setIsFavoriteResultLoading(true);
    loadFavoritesFromCDS().finally(() => {
      setIsFavoriteResultLoading(false);
    });


    return () => {
      isCurrent = false;
    };
  }, [cdsProfileId, criteria.category]);

  useEffect(() => {
    setError("");
    setBookingStates({});
  }, [criteria]);

  useEffect(() => {
    if (criteria.category !== "flights" || !includeBookings || !bookedFlightsQuery.data) {
      return;
    }

    const nextBookingStates = {};

    for (const result of results) {
      if (bookedFlightsQuery.data.some((booking) => isActiveBooking(booking) && isSameFlight(result, booking.flight))) {
        nextBookingStates[result.id] = "confirmed";
      }
    }

    setBookingStates(nextBookingStates);
  }, [bookedFlightsQuery.data, criteria.category, includeBookings, results]);

  async function handleBooking(type, itemId) {
    setError("");
    setBookingStates((current) => ({
      ...current,
      [itemId]: "booking"
    }));

    try {
      await createBookingMutation.mutateAsync({
        type,
        itemId,
        travelers: Number.parseInt(criteria.travelers, 10) || 1
      });

      setBookingStates((current) => ({
        ...current,
        [itemId]: "confirmed"
      }));
    } catch (requestError) {
      setBookingStates((current) => ({
        ...current,
        [itemId]: requestError.message.includes("already exists") ? "confirmed" : "idle"
      }));
      setError(requestError.message);
    }
  }

  async function toggleFavorite(itemId, flight) {
    const newFavorites = new Set(favorites);

    if (newFavorites.has(itemId)) {
      newFavorites.delete(itemId);
    } else {
      newFavorites.add(itemId);
    }

    setFavorites(newFavorites);

    if (cdsProfileId && criteria.category === "flights" && flight) {
      try {
        const favoritedFlights = Array.from(newFavorites).map((id) => `${id}`);

        await updateCDSProfile(cdsProfileId, {
          application_data: {
            [ASGARDEO_CLIENT_ID]: {
              fav_flights: favoritedFlights
            }
          }
        });
      } catch (updateError) {
        console.warn("Failed to update CDS profile:", updateError.message);
      }
    }
  }

  function handleFlightSelection(itemId) {
    navigate(buildFlightDetailsPath(itemId, criteria));
  }

  const searchSummary =
    criteria.category === "hotels"
      ? `Showing search results for hotels in ${criteria.to || "your destination"}`
      : `Showing search results for ${criteria.from || "Anywhere"} to ${criteria.to || "anywhere"}`;

  return (
    <main>
      <section className="results-hero">
        <div>
          <p className="eyebrow">Search results</p>
          <p className="results-search-summary">{searchSummary}</p>
          <p className="results-search-meta">
            {criteria.dates || "Flexible dates"} · {criteria.travelers || "Any travelers"}
          </p>
        </div>
        <SearchPanel
          compact
          initialCriteria={criteria}
          key={`${criteria.category}-${criteria.from}-${criteria.to}-${criteria.dates}-${criteria.travelers}`}
          locations={locations}
          onSearch={onSearch}
        />
      </section>

      {requestError && (
        <div className="api-status api-status--error" role="status">
          {requestError}
        </div>
      )}

      <section className="results-section" aria-label="Search results">
        {(isLoading || isFavoriteResultLoading || bookedFlightsQuery.isLoading) && <LoadingResults />}
        {!isLoading && !isFavoriteResultLoading && results.length === 0 && (
          <p className="empty-state">No results matched this search.</p>
        )}
        {!isLoading && !isFavoriteResultLoading &&
          results.map((item) => (
            <ResultCard
              category={criteria.category}
              item={item}
              key={item.id}
              bookingState={bookingStates[item.id] || "idle"}
              isFavorite={favorites.has(item.id)}
              onBook={handleBooking}
              onSelectFlight={handleFlightSelection}
              onToggleFavorite={toggleFavorite}
            />
          ))}
      </section>
    </main>
  );
}

export function ResultsPageWithAuth(props) {
  const auth = useApiAuth();

  return <ResultsPage {...props} auth={auth} includeBookings />;
}
