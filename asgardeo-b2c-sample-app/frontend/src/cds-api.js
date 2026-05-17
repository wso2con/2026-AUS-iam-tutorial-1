const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
export const ASGARDEO_CLIENT_ID = import.meta.env.VITE_ASGARDEO_CLIENT_ID || "";

const CDS_PROFILE_ID_STORAGE_KEY = "cds_profile_id";
const CDS_ANON_TRACKER_STORAGE_KEY = "cds_anonymous_profile_tracker";

let cdsProfileCreatePromise = null;
let cdsProfileId = null;
let cdsAnonymousProfileTracker = null;

function getStorageValue(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStorageValue(key, value) {
  if (!value) {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage write errors and continue with in-memory values.
  }
}

function removeStorageValue(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage removal errors.
  }
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || "API request failed");
  }

  return body;
}

export async function createCDSProfile(profilePayload = {}) {
  return requestJson("/api/cds/profiles", {
    method: "POST",
    body: JSON.stringify(profilePayload)
  });
}

export async function ensureCDSProfile(profilePayload = {}) {
  if (cdsProfileId) {
    return {
      profile_id: cdsProfileId,
      anonymous_profile_tracker: cdsAnonymousProfileTracker
    };
  }

  const storedProfileId = getStorageValue(CDS_PROFILE_ID_STORAGE_KEY);
  const storedAnonymousProfileTracker = getStorageValue(CDS_ANON_TRACKER_STORAGE_KEY);

  if (storedProfileId) {
    cdsProfileId = storedProfileId;
    cdsAnonymousProfileTracker = storedAnonymousProfileTracker || null;

    return {
      profile_id: storedProfileId,
      anonymous_profile_tracker: cdsAnonymousProfileTracker
    };
  }

  if (!cdsProfileCreatePromise) {
    cdsProfileCreatePromise = createCDSProfile(profilePayload)
      .then((response) => {
        cdsProfileId = response.profile_id || response.id || null;
        cdsAnonymousProfileTracker = response.anonymous_profile_tracker || null;

        if (cdsProfileId) {
          setStorageValue(CDS_PROFILE_ID_STORAGE_KEY, cdsProfileId);
        }

        if (cdsAnonymousProfileTracker) {
          setStorageValue(CDS_ANON_TRACKER_STORAGE_KEY, cdsAnonymousProfileTracker);
        }

        return response;
      })
      .finally(() => {
        cdsProfileCreatePromise = null;
      });
  }

  return cdsProfileCreatePromise;
}

export async function updateCDSProfile(profileId, profilePayload = {}) {
  if (!profileId) {
    throw new Error("Profile ID is required");
  }

  return requestJson(`/api/cds/profiles/${profileId}`, {
    method: "PATCH",
    body: JSON.stringify(profilePayload)
  });
}

export async function getCDSProfile(profileId) {
  if (!profileId) {
    throw new Error("Profile ID is required");
  }

  return requestJson(
    `/api/cds/profiles/${profileId}?application_identifier=*&includeApplicationData=true`,
    { method: "GET" }
  );
}

export function initializeCDSFromCookie() {
  const profileId = getStorageValue(CDS_PROFILE_ID_STORAGE_KEY);
  const anonymousProfileTracker = getStorageValue(CDS_ANON_TRACKER_STORAGE_KEY);

  if (profileId) {
    cdsProfileId = profileId;
  }

  if (anonymousProfileTracker) {
    cdsAnonymousProfileTracker = anonymousProfileTracker;
  }

  return profileId;
}

export function getAnonymousProfileTracker() {
  if (cdsAnonymousProfileTracker) {
    return cdsAnonymousProfileTracker;
  }

  const storedAnonymousProfileTracker = getStorageValue(CDS_ANON_TRACKER_STORAGE_KEY);

  if (storedAnonymousProfileTracker) {
    cdsAnonymousProfileTracker = storedAnonymousProfileTracker;
  }

  return cdsAnonymousProfileTracker;
}

export async function createSignInConfigWithCDSTracker() {
  let anonymousProfileTracker = getAnonymousProfileTracker();

  if (!anonymousProfileTracker) {
    try {
      const profile = await ensureCDSProfile({});
      anonymousProfileTracker = profile?.anonymous_profile_tracker || getAnonymousProfileTracker();
    } catch {
      anonymousProfileTracker = getAnonymousProfileTracker();
    }
  }

  return anonymousProfileTracker
    ? { anonymous_profile_tracker: anonymousProfileTracker }
    : {};
}

export function clearCDSCookies() {
  removeStorageValue(CDS_PROFILE_ID_STORAGE_KEY);
  removeStorageValue(CDS_ANON_TRACKER_STORAGE_KEY);
  cdsProfileId = null;
  cdsAnonymousProfileTracker = null;
  cdsProfileCreatePromise = null;
}
