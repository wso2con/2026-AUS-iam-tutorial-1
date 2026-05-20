import { randomUUID } from "node:crypto";
import { getRequestUserHint, resolveUser } from "../auth.js";
import {
  getBookedFlightById,
  listAllEnabledDealAlertConsents,
  listEnabledDealAlertConsents,
  transferDealAlertConsentBooking,
  upsertDealAlertConsent
} from "../db.js";
import {
  assertNonEmptyString,
  asyncHandler,
  isAllowedPreference,
  readJsonBody,
  sendJson
} from "../utils.js";

function getUsernameHint(request, resolvedUser, body = {}) {
  const requestUser = getRequestUserHint(request) || {};

  return (
    requestUser.username ||
    body.username ||
    body.email ||
    resolvedUser.username ||
    resolvedUser.email ||
    resolvedUser.id
  );
}

async function handleDealAlertConsent(request) {
  const body = await readJsonBody(request);
  let bookingId;
  let routeFrom;
  let routeTo;

  try {
    bookingId = assertNonEmptyString(body.bookingId, "bookingId");
    routeFrom = assertNonEmptyString(body.routeFrom, "routeFrom");
    routeTo = assertNonEmptyString(body.routeTo, "routeTo");
  } catch (error) {
    return {
      statusCode: 400,
      body: { error: error.message }
    };
  }

  const booking = getBookedFlightById(bookingId);

  if (!booking) {
    return {
      statusCode: 404,
      body: { error: "Flight booking not found" }
    };
  }

  const criteria = body.criteria && typeof body.criteria === "object" && !Array.isArray(body.criteria)
    ? body.criteria
    : {};

  if (criteria.minimumSavingsPercent === undefined && body.minimumSavingsPercent !== undefined) {
    criteria.minimumSavingsPercent = Number(body.minimumSavingsPercent);
  }

  if (criteria.maxStops === undefined && body.maxStops !== undefined) {
    criteria.maxStops = body.maxStops === null || body.maxStops === "" ? null : Number(body.maxStops);
  }

  if (criteria.timePreference === undefined && typeof body.timePreference === "string") {
    criteria.timePreference = body.timePreference;
  }

  if (criteria.timePreference === undefined && typeof body.datePreference === "string") {
    criteria.timePreference = body.datePreference;
  }

  if (criteria.sameCabinOnly === undefined && body.sameCabinOnly !== undefined) {
    criteria.sameCabinOnly = Boolean(body.sameCabinOnly);
  }

  if (criteria.timePreference !== undefined && !isAllowedPreference(String(criteria.timePreference))) {
    return {
      statusCode: 400,
      body: { error: "timePreference must be one of: any, earlier, later" }
    };
  }

  if (
    criteria.minimumSavingsPercent !== undefined &&
    (!Number.isFinite(Number(criteria.minimumSavingsPercent)) ||
      Number(criteria.minimumSavingsPercent) < 0 ||
      Number(criteria.minimumSavingsPercent) > 95)
  ) {
    return {
      statusCode: 400,
      body: { error: "minimumSavingsPercent must be a number between 0 and 95" }
    };
  }

  if (
    criteria.maxStops !== null &&
    criteria.maxStops !== undefined &&
    (!Number.isInteger(Number(criteria.maxStops)) || Number(criteria.maxStops) < 0)
  ) {
    return {
      statusCode: 400,
      body: { error: "maxStops must be a non-negative integer or null" }
    };
  }

  const consent = upsertDealAlertConsent({
    id: `deal-alert-consent-${randomUUID()}`,
    bookingId,
    username: booking.username,
    routeFrom,
    routeTo,
    criteria,
    enabled: Boolean(body.enabled),
    now: new Date().toISOString()
  });

  return {
    statusCode: 200,
    body: { data: consent }
  };
}

async function handleDealAlertConsentTransfer(request) {
  const body = await readJsonBody(request);
  let fromBookingId;
  let toBookingId;

  try {
    fromBookingId = assertNonEmptyString(body.fromBookingId, "fromBookingId");
    toBookingId = assertNonEmptyString(body.toBookingId, "toBookingId");
  } catch (error) {
    return {
      statusCode: 400,
      body: { error: error.message }
    };
  }

  const user = request.authenticatedUser || await resolveUser(request);
  const username = getUsernameHint(request, user, body);
  const consent = transferDealAlertConsentBooking({
    fromBookingId,
    toBookingId,
    username,
    now: new Date().toISOString()
  });

  if (!consent) {
    return {
      statusCode: 404,
      body: { error: "Deal alert consent could not be transferred for username" }
    };
  }

  return {
    statusCode: 200,
    body: { data: consent }
  };
}

export function registerDealAlertRoutes(app) {
  app.post("/api/deal-alert-consents", asyncHandler(async (request, response) => {
    const result = await handleDealAlertConsent(request);

    sendJson(response, result.statusCode, result.body);
  }));

  app.get("/api/deal-alert-consents", (_request: any, response: any) => {
    sendJson(response, 200, {
      data: listAllEnabledDealAlertConsents()
    });
  });

  app.post("/api/deal-alert-consents/transfer", asyncHandler(async (request, response) => {
    const result = await handleDealAlertConsentTransfer(request);

    sendJson(response, result.statusCode, result.body);
  }));

  app.get("/api/deal-alert-consents/:username", (request, response) => {
    sendJson(response, 200, {
      data: listEnabledDealAlertConsents(request.params.username)
    });
  });
}
