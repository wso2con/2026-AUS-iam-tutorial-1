export function formatPrice(currency, amount) {
  return `${currency === "USD" ? "$" : `${currency} `}${amount}`;
}

function formatBookingReference(bookingId) {
  const source = String(bookingId || "").replace(/^booking-/i, "");

  return source.replace(/[^a-z0-9]/gi, "").toUpperCase().padEnd(6, "0").slice(0, 6);
}

export function getBookingReference(booking) {
  return booking?.bookingReference || formatBookingReference(booking?.id);
}

export function isActiveBooking(booking) {
  return booking?.status !== "canceled";
}

export function isSameFlight(firstFlight, secondFlight) {
  return (
    firstFlight?.from === secondFlight?.from &&
    firstFlight?.to === secondFlight?.to &&
    firstFlight?.departureTime === secondFlight?.departureTime &&
    firstFlight?.arrivalTime === secondFlight?.arrivalTime &&
    firstFlight?.dates === secondFlight?.dates
  );
}
