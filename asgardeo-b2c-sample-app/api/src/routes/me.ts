import { resolveUser } from "../auth.js";
import {
  asyncHandler,
  fetchAsgardeoMeProfile,
  getAsgardeoBaseUrl,
  getBearerAccessToken,
  mapScimProfile,
  readJsonBody,
  sendJson
} from "../utils.js";

async function handleProfileUpdate(request: any) {
  const accessToken = getBearerAccessToken(request);

  if (!accessToken) {
    return {
      statusCode: 401,
      body: { error: "Missing bearer token" }
    };
  }

  const body = await readJsonBody(request);
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const operations: any[] = [
    {
      op: "replace",
      path: "name",
      value: {
        givenName: firstName,
        familyName: lastName
      }
    }
  ];

  if (email) {
    operations.push({
      op: "replace",
      path: "emails",
      value: [
        {
          value: email,
          type: "work",
          primary: true
        }
      ]
    });
  }

  const patchResponse = await fetch(`${getAsgardeoBaseUrl()}/scim2/Me`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/scim+json",
      Accept: "application/scim+json, application/json"
    },
    body: JSON.stringify({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: operations
    })
  });
  const patchData = await patchResponse.json().catch(() => ({}));

  if (!patchResponse.ok) {
    return {
      statusCode: patchResponse.status,
      body: {
        error:
          patchData.detail ||
          patchData.description ||
          patchData.error_description ||
          patchData.error ||
          "Failed to update Asgardeo profile"
      }
    };
  }

  const updatedProfile = patchResponse.status === 204 || !Object.keys(patchData).length
    ? await fetchAsgardeoMeProfile(accessToken)
    : patchData;

  return {
    statusCode: 200,
    body: { data: mapScimProfile(updatedProfile) }
  };
}

async function handleProfileFetch(request: any) {
  const accessToken = getBearerAccessToken(request);

  if (!accessToken) {
    return {
      statusCode: 401,
      body: { error: "Missing bearer token" }
    };
  }

  const profile = await fetchAsgardeoMeProfile(accessToken);

  return {
    statusCode: 200,
    body: { data: mapScimProfile(profile) }
  };
}

export function registerMeRoutes(app) {
  app.get("/api/me", asyncHandler(async (request: any, response) => {
    const user = request.authenticatedUser || await resolveUser(request);

    sendJson(response, 200, { data: user });
  }));

  app.get("/api/me/profile", asyncHandler(async (request, response) => {
    const result = await handleProfileFetch(request);

    sendJson(response, result.statusCode, result.body);
  }));

  app.patch("/api/me/profile", asyncHandler(async (request, response) => {
    const result = await handleProfileUpdate(request);

    sendJson(response, result.statusCode, result.body);
  }));
}
