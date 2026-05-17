import { useAsgardeo } from "@asgardeo/react";
import { Link } from "react-router-dom";
import { useApiAuth, useBookedFlightsQuery } from "../api-queries";
import { createSignInConfigWithCDSTracker } from "../cds-api";
import { formatPrice, getBookingReference } from "../utils/bookings";

export function BookingsPageWithAuth() {
  const { isSignedIn, signIn } = useAsgardeo();
  const auth = useApiAuth();
  const bookingsQuery = useBookedFlightsQuery({ auth });
  const bookings = bookingsQuery.data || [];
  const isLoading = bookingsQuery.isLoading;
  const error = bookingsQuery.error?.message || "";

  if (!isSignedIn) {
    return (
      <main className="bookings-page">
        <section className="management-empty">
          <div>
            <p className="eyebrow">Bookings</p>
            <h1>Sign in to manage your bookings.</h1>
            <p>View confirmed trips, booking status, passenger count, and flight details.</p>
          </div>
          <button
            className="dashboard-action dashboard-action--secondary"
            type="button"
            onClick={async () => {
              const signInConfig = await createSignInConfigWithCDSTracker();
              signIn(signInConfig);
            }}
          >
            Sign in
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="bookings-page">
      <section className="management-header">
        <div>
          <p className="eyebrow">Management</p>
          <h1>Bookings</h1>
        </div>
      </section>

      {error && (
        <div className="api-status api-status--error" role="status">
          {error}
        </div>
      )}

      <section className="management-panel" aria-label="Booked flights">
        {isLoading && <p className="empty-state management-message">Loading booked flights...</p>}
        {!isLoading && bookings.length === 0 && (
          <div className="management-empty-state">
            <h2>No bookings yet</h2>
            <p>Your confirmed flights will appear here after booking.</p>
            <Link className="dashboard-action dashboard-action--secondary" to="/flights#search">
              Start searching
            </Link>
          </div>
        )}
        {!isLoading &&
          bookings.length > 0 && (
            <div className="booking-table-heading" aria-hidden="true">
              <span>Route</span>
              <span>Reference</span>
              <span>Schedule</span>
              <span>Travelers</span>
              <span>Total</span>
            </div>
          )}
        {!isLoading &&
          bookings.length > 0 &&
          bookings.map((booking) => (
            <Link className="booking-row" to={`/bookings/${booking.id}`} key={booking.id}>
              <div className="booking-route">
                <span className={`booking-status ${booking.status === "canceled" ? "booking-status--canceled" : ""}`}>
                  {booking.status}
                </span>
                <strong>{booking.flight.from} to {booking.flight.to}</strong>
                <small>Booked {new Date(booking.createdAt).toLocaleDateString()}</small>
              </div>
              <div className="booking-cell">
                <strong>{getBookingReference(booking)}</strong>
                <span>Booking reference</span>
              </div>
              <div className="booking-cell">
                <strong>{booking.flight.departureTime} - {booking.flight.arrivalTime}</strong>
                <span>{booking.flight.duration} · {booking.flight.dates}</span>
              </div>
              <div className="booking-cell">
                <strong>
                  {booking.travelers} traveler{booking.travelers === 1 ? "" : "s"}
                </strong>
                <span>{booking.flight.cabin}</span>
              </div>
              <div className="booking-price">
                <strong>{formatPrice(booking.flight.currency, booking.flight.price)}</strong>
              </div>
            </Link>
          ))}
      </section>
    </main>
  );
}
