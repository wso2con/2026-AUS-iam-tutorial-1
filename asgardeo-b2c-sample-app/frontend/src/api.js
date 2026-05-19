const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const AGENT_API_BASE_URL = import.meta.env.VITE_AGENT_API_BASE_URL;

async function requestJson(path, options = {}) {
  const { auth, authRequired = false, body, ...fetchOptions } = options;
  const headers = {
    "Content-Type": "application/json",
    ...await getAuthHeaders(auth, { required: authRequired }),
    ...fetchOptions.headers
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers
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

function getUserHeaders(user) {
  const headers = {};
  const username = user?.userName || user?.username || user?.email || user?.sub || user?.id || "";
  const userId = username || user?.sub || user?.id;
  const email = user?.email || user?.mail || "";

  if (username) {
    headers["X-Wayfinder-Username"] = username;
  }

  if (userId) {
    headers["X-Wayfinder-User-Id"] = userId;
  }

  if (email) {
    headers["X-Wayfinder-Email"] = email;
  }

  return headers;
}

async function getAuthHeaders(auth = {}, options = {}) {
  const userHeaders = getUserHeaders(auth.user);

  if (typeof auth.getAccessToken !== "function") {
    if (options.required) {
      throw new Error("Authentication is required for this request.");
    }

    return userHeaders;
  }

  try {
    const accessToken = normalizeAccessToken(await auth.getAccessToken());

    if (options.required && !accessToken) {
      throw new Error("Authentication is required for this request.");
    }

    return {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...userHeaders
    };
  } catch (error) {
    if (options.required) {
      throw error;
    }

    return userHeaders;
  }
}

function normalizeAccessToken(accessToken) {
  if (typeof accessToken === "string") {
    return accessToken;
  }

  if (typeof accessToken?.accessToken === "string") {
    return accessToken.accessToken;
  }

  if (typeof accessToken?.access_token === "string") {
    return accessToken.access_token;
  }

  return "";
}

export async function getFlights(searchParams = {}, auth) {
  const response = await requestJson(`/api/flights${createQuery(searchParams)}`, { auth });

  return response.data;
}

export async function getFlight(flightId, auth) {
  const response = await requestJson(`/api/flights/${encodeURIComponent(flightId)}`, { auth });

  return response.data;
}

export async function getHotels(searchParams = {}, auth) {
  const response = await requestJson(`/api/hotels${createQuery(searchParams)}`, { auth });

  return response.data;
}

export async function getTrips(searchParams = {}, auth) {
  const response = await requestJson(`/api/trips${createQuery(searchParams)}`, { auth });

  return response.data;
}

export async function getLocations(searchParams = {}, auth) {
  const response = await requestJson(`/api/locations${createQuery(searchParams)}`, { auth });

  return response.data;
}

export async function createBooking(booking, auth) {
  return await requestJson("/api/bookings", {
    auth,
    authRequired: true,
    method: "POST",
    body: booking
  });
}

export async function getBookedFlights(auth) {
  const response = await requestJson("/api/bookings/flights", {
    auth,
    authRequired: true
  });

  return response.data;
}

export async function cancelBooking(bookingId, auth) {
  const response = await requestJson(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`, {
    auth,
    authRequired: true,
    method: "PATCH"
  });

  return response.data;
}

export async function getProfile(auth) {
  const response = await requestJson("/api/me/profile", {
    auth,
    authRequired: true
  });

  return response.data;
}

export async function updateProfile(profile, auth) {
  const response = await requestJson("/api/me/profile", {
    auth,
    authRequired: true,
    method: "PATCH",
    body: profile
  });

  return response.data;
}

async function requestAgentJson(path, options = {}) {
  const { auth, body, ...fetchOptions } = options;
  const headers = {
    "Content-Type": "application/json",
    ...await getAuthHeaders(auth, { required: true }),
    ...fetchOptions.headers
  };

  const response = await fetch(`${AGENT_API_BASE_URL}${path}`, {
    ...fetchOptions,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers
  });
  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = Array.isArray(responseBody.detail)
      ? responseBody.detail.map((item) => item.msg || item.message || String(item)).join(", ")
      : responseBody.detail;

    throw new Error(responseBody.message || responseBody.error || detail || "Agent request failed");
  }

  return responseBody;
}

export async function sendAgentChatMessage(message, auth) {
  return await requestAgentJson("/api/chat", {
    auth,
    method: "POST",
    body: { message }
  });
}

export async function getAgentOboUrl(auth) {
  return await requestAgentJson("/api/obo/url", { auth });
}
