import { useEffect, useState } from "react";
import { useAsgardeo } from "@asgardeo/react";
import { Link } from "react-router-dom";
import { Ban, ChevronLeft, Plane, ShieldCheck } from "lucide-react";
import { useApiAuth, useBookedFlightsQuery, useCancelBookingMutation } from "../api-queries";
import { createSignInConfigWithCDSTracker } from "../cds-api";
import { formatPrice, getBookingReference } from "../utils/bookings";

export function BookingDetailsPageWithAuth({ bookingId }) {
  const { isSignedIn, signIn } = useAsgardeo();
  const auth = useApiAuth();
  const bookingsQuery = useBookedFlightsQuery({ auth });
  const cancelBookingMutation = useCancelBookingMutation(auth);
  const [booking, setBooking] = useState(null);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const hasBookingData = Array.isArray(bookingsQuery.data);
  const isLoading =
    auth.isLoading
    || bookingsQuery.isLoading
    || (!bookingsQuery.error && !hasBookingData)
    || (!booking && bookingsQuery.isFetching);
  const isCanceling = cancelBookingMutation.isPending;
  const isCanceled = booking?.status === "canceled";

  useEffect(() => {
    if (!isSignedIn || auth.isLoading || bookingsQuery.isLoading) {
      return;
    }

    if (bookingsQuery.error) {
      setBooking(null);
      setError(bookingsQuery.error.message);
      setStatusMessage("");
      return;
    }

    if (!hasBookingData) {
      setError("");
      setStatusMessage("");
      return;
    }

    const selectedBooking = bookingsQuery.data.find((item) => String(item.id) === String(bookingId));

    if (!selectedBooking && bookingsQuery.isFetching) {
      setError("");
      setStatusMessage("");
      return;
    }

    setBooking(selectedBooking || null);
    setError(bookingsQuery.error?.message || (selectedBooking ? "" : "Booking not found."));
    setStatusMessage("");
  }, [
    auth.isLoading,
    bookingId,
    bookingsQuery.data,
    bookingsQuery.error,
    bookingsQuery.isFetching,
    bookingsQuery.isLoading,
    hasBookingData,
    isSignedIn
  ]);

  async function handleCancelBooking() {
    if (!booking || isCanceling || isCanceled) {
      return;
    }

    setError("");
    setStatusMessage("");

    try {
      const updatedBooking = await cancelBookingMutation.mutateAsync(booking.id);

      setBooking(updatedBooking);
      setIsCancelConfirmOpen(false);
      setStatusMessage("Booking canceled.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  if (!isSignedIn) {
    return (
      <main className="bookings-page">
        <section className="management-empty">
          <div>
            <p className="eyebrow">Booking details</p>
            <h1>Sign in to view this booking.</h1>
            <p>Booking details are available after authentication.</p>
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
          <Link className="back-link" to="/bookings">
            <ChevronLeft size={18} />
            Back to bookings
          </Link>
          <h1>{booking ? `${booking.flight.from} to ${booking.flight.to}` : "Booking"}</h1>
          <p>{booking ? `Reference ${getBookingReference(booking)}` : "Loading booking information"}</p>
        </div>
      </section>

      {error && (
        <div className="api-status api-status--error" role="status">
          {error}
        </div>
      )}

      {statusMessage && (
        <div className="api-status api-status--success" role="status">
          {statusMessage}
        </div>
      )}

      {isLoading && <p className="empty-state management-message">Loading booking details...</p>}

      {!isLoading && booking && (
        <section className="booking-detail-panel booking-confirmed-panel" aria-label="Booking information">
          <div className="booking-flight-widget">
            <div className="booking-flight-main">
              <div className="booking-detail-topline">
                <span className={`booking-status ${isCanceled ? "booking-status--canceled" : ""}`}>
                  {booking.status}
                </span>
                <strong>{booking.flight.airline}</strong>
              </div>
              <div className="itinerary-route">
                <div>
                  <span>{booking.flight.departureTime}</span>
                  <strong>{booking.flight.from}</strong>
                </div>
                <div className="itinerary-line">
                  <Plane size={20} />
                </div>
                <div>
                  <span>{booking.flight.arrivalTime}</span>
                  <strong>{booking.flight.to}</strong>
                </div>
              </div>
              <div className="itinerary-meta">
                <span>{booking.flight.duration}</span>
                <span>{booking.flight.stops === 0 ? "Nonstop" : `${booking.flight.stops} stop`}</span>
                <span>{booking.flight.cabin}</span>
              </div>
            </div>
          </div>

          <div className="booking-detail-sections booking-confirmed-sections">
            <section>
              <h2>Trip details</h2>
              <dl>
                <div>
                  <dt>Travel dates</dt>
                  <dd>{booking.flight.dates}</dd>
                </div>
                <div>
                  <dt>Travelers</dt>
                  <dd>
                    {booking.travelers} traveler{booking.travelers === 1 ? "" : "s"}
                  </dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{booking.flight.duration}</dd>
                </div>
              </dl>
            </section>
            <section>
              <h2>Booking details</h2>
              <dl>
                <div>
                  <dt>Reference</dt>
                  <dd>{getBookingReference(booking)}</dd>
                </div>
                <div>
                  <dt>Booked on</dt>
                  <dd>{new Date(booking.createdAt).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{booking.status}</dd>
                </div>
              </dl>
            </section>
            <section>
              <h2>Payment</h2>
              <dl>
                <div>
                  <dt>Total paid</dt>
                  <dd>{formatPrice(booking.flight.currency, booking.flight.price)}</dd>
                </div>
                <div>
                  <dt>Fare type</dt>
                  <dd>{booking.flight.cabin}</dd>
                </div>
              </dl>
            </section>
          </div>

          {!isCanceled && (
            <section className="booking-action-section" aria-label="Booking actions">
              <div className="booking-action-icon" aria-hidden="true">
                <Ban size={24} />
              </div>
              <div>
                <span>Booking actions</span>
                <h2>Cancel this booking.</h2>
                <p>Canceling updates the booking status and turns off better-deal alerts for this trip.</p>
              </div>
              <button
                className="booking-cancel-button"
                type="button"
                disabled={isCanceling || isCancelConfirmOpen}
                onClick={() => setIsCancelConfirmOpen(true)}
              >
                Cancel booking
              </button>
              {isCancelConfirmOpen && (
                <div className="booking-cancel-confirmation" role="alertdialog" aria-modal="false">
                  <div>
                    <strong>Cancel booking {getBookingReference(booking)}?</strong>
                    <p>This will mark the booking as canceled and turn off better-deal alerts for this trip.</p>
                  </div>
                  <div className="booking-cancel-confirmation-actions">
                    <button
                      className="booking-cancel-accent-button"
                      type="button"
                      disabled={isCanceling}
                      onClick={() => setIsCancelConfirmOpen(false)}
                    >
                      Keep booking
                    </button>
                    <button
                      className="booking-cancel-button"
                      type="button"
                      disabled={isCanceling}
                      onClick={handleCancelBooking}
                    >
                      {isCanceling ? "Canceling..." : "Confirm cancellation"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {!isCanceled && (
            <section className="travel-insurance-section" aria-label="Travel insurance offer">
              <div className="travel-insurance-icon" aria-hidden="true">
                <ShieldCheck size={26} />
              </div>
              <div>
                <span>Travel protection</span>
                <h2>Add travel insurance before you fly.</h2>
                <p>
                  Cover unexpected delays, medical emergencies, and baggage issues for this trip.
                </p>
              </div>
              <button className="travel-insurance-button" type="button">
                Buy insurance
              </button>
            </section>
          )}
        </section>
      )}
    </main>
  );
}
