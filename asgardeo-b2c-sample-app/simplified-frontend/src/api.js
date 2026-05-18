const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

async function requestJson(path, options = {}) {
  const { body, ...fetchOptions } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers: { "Content-Type": "application/json", ...fetchOptions.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(responseBody.error || "API request failed");
  }

  return responseBody;
}

function createQuery(searchParams = {}) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();

  return query ? `?${query}` : "";
}

export async function getFlights(searchParams = {}) {
  const response = await requestJson(`/api/flights${createQuery(searchParams)}`);

  return response.data;
}

export async function getFlight(flightId) {
  const response = await requestJson(`/api/flights/${encodeURIComponent(flightId)}`);

  return response.data;
}

export async function getHotels(searchParams = {}) {
  const response = await requestJson(`/api/hotels${createQuery(searchParams)}`);

  return response.data;
}

export async function getTrips(searchParams = {}) {
  const response = await requestJson(`/api/trips${createQuery(searchParams)}`);

  return response.data;
}

export async function getLocations(searchParams = {}) {
  const response = await requestJson(`/api/locations${createQuery(searchParams)}`);

  return response.data;
}

export async function createBooking(booking) {
  return await requestJson("/api/bookings", {
    method: "POST",
    body: booking
  });
}

export async function getBookedFlights() {
  const response = await requestJson("/api/bookings/flights");

  return response.data;
}

export async function cancelBooking(bookingId) {
  const response = await requestJson(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`, {
    method: "PATCH"
  });

  return response.data;
}

export async function getProfile() {
  const response = await requestJson("/api/me/profile");

  return response.data;
}

export async function updateProfile(profile) {
  const response = await requestJson("/api/me/profile", {
    method: "PATCH",
    body: profile
  });

  return response.data;
}
