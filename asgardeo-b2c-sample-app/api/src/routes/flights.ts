import { randomUUID } from "node:crypto";
import {
  createFlightRecord,
  deleteFlightById,
  findFlightById,
  listMatchingDealAlertConsentsForFlight
} from "../db.js";
import {
  assertNonEmptyString,
  asyncHandler,
  getSearchParams,
  normalizeOptionalTags,
  notifyAgentOfDealMatches,
  readJsonBody,
  searchFlights,
  sendJson
} from "../utils.js";

async function handleFlightCreate(request) {
  const body = await readJsonBody(request);
  let from;
  let to;
  let airline;
  let departureTime;
  let arrivalTime;
  let duration;
  let currency;
  let cabin;
  let dates;

  try {
    from = assertNonEmptyString(body.from, "from");
    to = assertNonEmptyString(body.to, "to");
    airline = assertNonEmptyString(body.airline, "airline");
    departureTime = assertNonEmptyString(body.departureTime, "departureTime");
    arrivalTime = assertNonEmptyString(body.arrivalTime, "arrivalTime");
    duration = assertNonEmptyString(body.duration, "duration");
    currency = assertNonEmptyString(body.currency || "USD", "currency");
    cabin = assertNonEmptyString(body.cabin || "Economy", "cabin");
    dates = assertNonEmptyString(body.dates, "dates");
  } catch (error) {
    return {
      statusCode: 400,
      body: { error: error.message }
    };
  }

  const stops = Number(body.stops ?? 0);
  const price = Number(body.price);

  if (!Number.isInteger(stops) || stops < 0) {
    return {
      statusCode: 400,
      body: { error: "stops must be a non-negative integer" }
    };
  }

  if (!Number.isFinite(price) || price <= 0) {
    return {
      statusCode: 400,
      body: { error: "price must be a positive number" }
    };
  }

  const sourceId = body.id || `flight-${from}-${to}-${randomUUID().slice(0, 8)}`;
  const id = String(sourceId).trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

  if (!id) {
    return {
      statusCode: 400,
      body: { error: "id could not be derived from the provided flight details" }
    };
  }

  if (findFlightById(id)) {
    return {
      statusCode: 409,
      body: { error: "Flight already exists" }
    };
  }

  const flight = createFlightRecord({
    id,
    from,
    to,
    airline,
    departureTime,
    arrivalTime,
    duration,
    stops,
    price,
    currency,
    cabin,
    dates,
    tags: normalizeOptionalTags(body.tags)
  });
  const matches = listMatchingDealAlertConsentsForFlight(id);

  await notifyAgentOfDealMatches(flight, matches);

  return {
    statusCode: 201,
    body: { data: flight, matchedDealAlerts: matches.length }
  };
}

export function registerFlightRoutes(app) {
  app.get("/api/flights", (request, response) => {
    sendJson(response, 200, {
      data: searchFlights(getSearchParams(request))
    });
  });

  app.post("/api/flights", asyncHandler(async (request, response) => {
    const result = await handleFlightCreate(request);

    sendJson(response, result.statusCode, result.body);
  }));

  app.get("/api/flights/:flightId", (request, response) => {
    const flight = findFlightById(request.params.flightId);

    if (!flight) {
      return sendJson(response, 404, { error: "Flight not found" });
    }

    return sendJson(response, 200, { data: flight });
  });

  app.delete("/api/flights/:flightId", (request, response) => {
    const result = deleteFlightById(request.params.flightId);

    if (result.reason === "not-found") {
      return sendJson(response, 404, { error: "Flight not found" });
    }

    if (result.reason === "in-use") {
      return sendJson(response, 409, {
        error: "Flight is used by existing bookings or trips",
        bookingCount: result.bookingCount,
        tripCount: result.tripCount
      });
    }

    return sendJson(response, 200, { data: result.flight });
  });
}
