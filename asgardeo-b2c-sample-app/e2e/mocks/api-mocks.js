import { flights, initialBooking, locations } from "./fixtures.js";

function jsonResponse(body, status = 200) {
  return {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

function parseJson(request) {
  try {
    return request.postDataJSON();
  } catch {
    return {};
  }
}

function searchFlights(searchParams) {
  const from = searchParams.get("from")?.toLowerCase();
  const to = searchParams.get("to")?.toLowerCase();

  return flights.filter((flight) => {
    const matchesFrom = !from || flight.from.toLowerCase().includes(from);
    const matchesTo = !to || flight.to.toLowerCase().includes(to);

    return matchesFrom && matchesTo;
  });
}

export async function mockWayfinderApi(page) {
  const state = {
    bookings: [{ ...initialBooking }],
    profile: {
      firstName: "Mira",
      lastName: "Stone",
      email: "mira.stone@example.com",
      memberSince: "2026-01-15T00:00:00.000Z"
    }
  };

  await page.route("https://api.qrserver.com/**", (route) => route.fulfill({
    status: 204,
    body: ""
  }));

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (method === "POST" && path === "/api/cds/profiles") {
      await route.fulfill(jsonResponse({
        profile_id: "cds-e2e-profile",
        anonymous_profile_tracker: "anon-e2e"
      }));
      return;
    }

    if (path.startsWith("/api/cds/profiles/")) {
      if (method === "GET") {
        await route.fulfill(jsonResponse({
          data: {
            application_data: {
              "wayfinder-e2e-client": {
                flight_no: []
              }
            }
          }
        }));
        return;
      }

      if (method === "PATCH") {
        await route.fulfill(jsonResponse(parseJson(request)));
        return;
      }
    }

    if (method === "GET" && path === "/api/locations") {
      await route.fulfill(jsonResponse({
        data: locations[url.searchParams.get("category")] || []
      }));
      return;
    }

    if (method === "GET" && path === "/api/flights") {
      await route.fulfill(jsonResponse({
        data: searchFlights(url.searchParams)
      }));
      return;
    }

    if (method === "GET" && path.startsWith("/api/flights/")) {
      const flightId = decodeURIComponent(path.replace("/api/flights/", ""));
      const flight = flights.find((item) => item.id === flightId);

      await route.fulfill(
        flight
          ? jsonResponse({ data: flight })
          : jsonResponse({ error: "Flight not found" }, 404)
      );
      return;
    }

    if (method === "GET" && path === "/api/bookings/flights") {
      await route.fulfill(jsonResponse({ data: state.bookings }));
      return;
    }

    if (method === "POST" && path === "/api/bookings") {
      const payload = parseJson(request);
      const flight = flights.find((item) => item.id === payload.itemId);

      if (!flight) {
        await route.fulfill(jsonResponse({ error: "Flight not found" }, 404));
        return;
      }

      const booking = {
        id: "booking-e2e-new",
        bookingReference: "E2E101",
        flight,
        travelers: payload.travelers || 1,
        status: "confirmed",
        createdAt: "2026-05-16T09:30:00.000Z"
      };

      state.bookings = [booking, ...state.bookings.filter((item) => item.id !== booking.id)];
      await route.fulfill(jsonResponse(booking, 201));
      return;
    }

    if (method === "PATCH" && path.startsWith("/api/bookings/") && path.endsWith("/cancel")) {
      const bookingId = decodeURIComponent(path.replace("/api/bookings/", "").replace("/cancel", ""));
      const booking = state.bookings.find((item) => item.id === bookingId);

      if (!booking) {
        await route.fulfill(jsonResponse({ error: "Booking not found" }, 404));
        return;
      }

      booking.status = "canceled";
      await route.fulfill(jsonResponse({ data: booking }));
      return;
    }

    if (method === "GET" && path === "/api/me/profile") {
      await route.fulfill(jsonResponse({ data: state.profile }));
      return;
    }

    if (method === "PATCH" && path === "/api/me/profile") {
      state.profile = {
        ...state.profile,
        ...parseJson(request)
      };
      await route.fulfill(jsonResponse({ data: state.profile }));
      return;
    }

    await route.fulfill(jsonResponse({ error: `Unhandled E2E mock route: ${method} ${path}` }, 404));
  });
}
