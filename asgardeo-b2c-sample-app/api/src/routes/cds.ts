import {
  asyncHandler,
  extractCookieValue,
  getAsgardeoBaseUrl,
  getCDSToken,
  sendJson
} from "../utils.js";

export function registerCDSRoutes(app) {
  app.post("/api/cds/profiles", asyncHandler(async (request, response) => {
    const token = await getCDSToken();
    const cdsEndpoint = `${getAsgardeoBaseUrl()}/cds/api/v1/profiles`;
    const cdsResponse = await fetch(cdsEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request.body || {})
    });
    const cdsData = await cdsResponse.json().catch(() => ({}));

    if (!cdsResponse.ok) {
      return sendJson(response, cdsResponse.status, {
        error: cdsData.message || cdsData.description || "Failed to create CDS profile"
      });
    }

    const rawSetCookies =
      typeof cdsResponse.headers.getSetCookie === "function"
        ? cdsResponse.headers.getSetCookie()
        : [];
    const singleSetCookie = cdsResponse.headers.get("set-cookie");
    const setCookieHeaders =
      rawSetCookies.length > 0
        ? rawSetCookies
        : singleSetCookie
          ? [singleSetCookie]
          : [];
    const cdsProfileCookie = extractCookieValue(setCookieHeaders, "cds_profile");

    return sendJson(response, 201, {
      ...cdsData,
      cds_profile: cdsProfileCookie
    });
  }));

  app.get("/api/cds/profiles/:profileId", asyncHandler(async (request, response) => {
    const token = await getCDSToken();
    const cdsEndpoint = new URL(
      `${getAsgardeoBaseUrl()}/cds/api/v1/profiles/${request.params.profileId}`
    );
    const applicationIdentifier = request.query.application_identifier;
    const includeApplicationData = request.query.includeApplicationData;

    if (typeof applicationIdentifier === "string") {
      cdsEndpoint.searchParams.set("application_identifier", applicationIdentifier);
    }

    if (typeof includeApplicationData === "string") {
      cdsEndpoint.searchParams.set("includeApplicationData", includeApplicationData);
    }

    const cdsResponse = await fetch(cdsEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });
    const cdsData = await cdsResponse.json().catch(() => ({}));

    if (!cdsResponse.ok) {
      return sendJson(response, cdsResponse.status, {
        error: cdsData.error_description || cdsData.error || "Failed to fetch CDS profile"
      });
    }

    return sendJson(response, 200, cdsData);
  }));

  app.patch("/api/cds/profiles/:profileId", asyncHandler(async (request, response) => {
    const token = await getCDSToken();
    const cdsEndpoint = `${getAsgardeoBaseUrl()}/cds/api/v1/profiles/${request.params.profileId}`;
    const cdsResponse = await fetch(cdsEndpoint, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request.body || {})
    });
    const cdsData = await cdsResponse.json().catch(() => ({}));

    if (!cdsResponse.ok) {
      return sendJson(response, cdsResponse.status, {
        error: cdsData.error_description || cdsData.error || "Failed to update CDS profile"
      });
    }

    return sendJson(response, 200, cdsData);
  }));
}
