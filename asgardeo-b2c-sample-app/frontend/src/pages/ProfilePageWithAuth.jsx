import { useEffect, useState } from "react";
import { useAsgardeo } from "@asgardeo/react";
import { CircleUserRound, Pencil, Save, ShieldCheck, X } from "lucide-react";
import { useApiAuth, useProfileQuery, useUpdateProfileMutation } from "../api-queries";
import { createSignInConfigWithCDSTracker } from "../cds-api";

const walletCredentialOffer = import.meta.env.VITE_WALLET_CREDENTIAL_OFFER || "";

function getUserValue(user, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current?.[part], user);

    if (value) {
      return value;
    }
  }

  return "";
}

function getUserEmail(user) {
  const email = getUserValue(user, ["email", "mail"]);

  if (email) {
    return email;
  }

  const emails = user?.emails;

  if (Array.isArray(emails)) {
    const primaryEmail = emails.find((item) => item?.primary);
    const firstEmail = primaryEmail || emails[0];

    if (typeof firstEmail === "string") {
      return firstEmail;
    }

    return firstEmail?.value || firstEmail?.display || "";
  }

  if (typeof emails === "string") {
    return emails;
  }

  if (emails && typeof emails === "object") {
    return emails.value || emails.display || "";
  }

  return "";
}

function getProfileEmail(profile) {
  if (profile?.email) {
    return profile.email;
  }

  const rawEmails = profile?.raw?.emails || profile?.emails;

  if (Array.isArray(rawEmails)) {
    const primaryEmail = rawEmails.find((item) => item?.primary === true || item?.primary === "true");
    const firstEmail = primaryEmail || rawEmails[0];

    if (typeof firstEmail === "string") {
      return firstEmail;
    }

    return firstEmail?.value || firstEmail?.display || "";
  }

  return "";
}

function formatMemberSince(value) {
  if (!value) {
    return "Not available";
  }

  const date = Number.isFinite(Number(value)) ? new Date(Number(value)) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

export function ProfilePageWithAuth() {
  const { isSignedIn, signIn, user } = useAsgardeo();
  const auth = useApiAuth();
  const profileQuery = useProfileQuery({ auth });
  const updateProfileMutation = useUpdateProfileMutation(auth);
  const claimFirstName = getUserValue(user, ["name.givenName", "given_name", "givenName"]);
  const claimLastName = getUserValue(user, ["name.familyName", "family_name", "familyName"]);
  const claimEmail = getUserEmail(user);
  const profileLoadKey = getUserValue(user, ["sub", "id", "email", "mail"]) || claimEmail || "signed-in-profile";
  const createdDate = getUserValue(user, [
    "created_at",
    "createdAt",
    "created",
    "meta.created",
    "metadata.created",
    "rawClaims.created_at",
    "rawClaims.created"
  ]);
  const [profile, setProfile] = useState({
    firstName: "",
    lastName: "",
    email: "",
    memberSince: ""
  });
  const [draftProfile, setDraftProfile] = useState(profile);
  const [isEditing, setIsEditing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const isSaving = updateProfileMutation.isPending;
  const firstName = profile.firstName;
  const lastName = profile.lastName;
  const email = profile.email;
  const memberSince = profile.memberSince || createdDate;
  const membershipPayload = walletCredentialOffer || email || "wayfinder-membership";

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }

    const claimProfile = {
      firstName: claimFirstName || "",
      lastName: claimLastName || "",
      email: claimEmail || "",
      memberSince: createdDate || ""
    };

    setProfile(claimProfile);
    setDraftProfile(claimProfile);
  }, [claimFirstName, claimLastName, claimEmail, createdDate, isSignedIn, profileLoadKey]);

  useEffect(() => {
    if (!profileQuery.data) {
      return;
    }

    const nextProfile = {
      firstName: profileQuery.data.firstName || claimFirstName || "",
      lastName: profileQuery.data.lastName || claimLastName || "",
      email: getProfileEmail(profileQuery.data) || claimEmail || "",
      memberSince: profileQuery.data.memberSince || createdDate || ""
    };

    setProfile(nextProfile);
    setDraftProfile(nextProfile);
  }, [claimEmail, claimFirstName, claimLastName, createdDate, profileQuery.data]);

  useEffect(() => {
    if (profileQuery.error) {
      console.warn("Unable to load Asgardeo profile:", profileQuery.error);
    }
  }, [profileQuery.error]);

  function updateDraftProfile(field, value) {
    setDraftProfile((current) => ({
      ...current,
      [field]: value
    }));
  }

  function startEditing() {
    setDraftProfile(profile);
    setIsEditing(true);
    setStatusMessage("");
    setErrorMessage("");
  }

  function cancelEditing() {
    setDraftProfile(profile);
    setIsEditing(false);
    setStatusMessage("");
    setErrorMessage("");
  }

  async function handleProfileSave(event) {
    event.preventDefault();

    const nextProfile = {
      firstName: draftProfile.firstName.trim(),
      lastName: draftProfile.lastName.trim(),
      email: draftProfile.email.trim()
    };

    setStatusMessage("");
    setErrorMessage("");

    try {
      const savedProfile = await updateProfileMutation.mutateAsync(nextProfile);
      const displayProfile = {
        firstName: savedProfile.firstName || nextProfile.firstName,
        lastName: savedProfile.lastName || nextProfile.lastName,
        email: savedProfile.email || nextProfile.email,
        memberSince: savedProfile.memberSince || profile.memberSince
      };

      setProfile(displayProfile);
      setDraftProfile(displayProfile);
      setIsEditing(false);
      setStatusMessage("Profile updated in Asgardeo.");
    } catch (error) {
      setErrorMessage(error.message || "Unable to update your profile in Asgardeo.");
    }
  }

  if (!isSignedIn) {
    return (
      <main className="bookings-page">
        <section className="management-empty">
          <div>
            <p className="eyebrow">Profile</p>
            <h1>Sign in to view your profile.</h1>
            <p>Your Wayfinder profile is available after authentication.</p>
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
          <p className="eyebrow">Profile</p>
          <h1>{firstName || lastName ? `${firstName} ${lastName}`.trim() : "Your Wayfinder profile"}</h1>
          <p>{email || "Membership details and your digital membership ID."}</p>
        </div>
      </section>

      {statusMessage && (
        <div className="api-status api-status--success" role="status">
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div className="api-status api-status--error" role="alert">
          {errorMessage}
        </div>
      )}

      <section className="profile-panel" aria-label="Profile information">
        <div className="profile-card">
          <div className="profile-card-header">
            <div className="profile-avatar" aria-hidden="true">
              <CircleUserRound size={38} />
            </div>
            <div>
              <span>Account profile</span>
              <h2>{firstName || lastName ? `${firstName} ${lastName}`.trim() : "Traveller"}</h2>
              <p>{email || "No email available"}</p>
            </div>
            {!isEditing && (
              <button className="profile-edit-button" type="button" onClick={startEditing}>
                <Pencil size={16} />
                <span>Edit</span>
              </button>
            )}
          </div>
          {isEditing ? (
            <form className="profile-edit-form" onSubmit={handleProfileSave}>
              <label>
                <span>First name</span>
                <input
                  value={draftProfile.firstName}
                  onChange={(event) => updateDraftProfile("firstName", event.target.value)}
                />
              </label>
              <label>
                <span>Last name</span>
                <input
                  value={draftProfile.lastName}
                  onChange={(event) => updateDraftProfile("lastName", event.target.value)}
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  value={draftProfile.email}
                  onChange={(event) => updateDraftProfile("email", event.target.value)}
                />
              </label>
              <div className="profile-edit-actions">
                <button className="profile-accent-button" type="button" onClick={cancelEditing} disabled={isSaving}>
                  <X size={16} />
                  <span>Cancel</span>
                </button>
                <button className="profile-primary-button" type="submit" disabled={isSaving}>
                  <Save size={16} />
                  <span>{isSaving ? "Saving..." : "Save changes"}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="profile-details">
              <dl>
                <div>
                  <dt>First name</dt>
                  <dd>{firstName || "Not available"}</dd>
                </div>
                <div>
                  <dt>Last name</dt>
                  <dd>{lastName || "Not available"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{email || "Not available"}</dd>
                </div>
                <div>
                  <dt>Member since</dt>
                  <dd>{formatMemberSince(memberSince)}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        <aside className="membership-id-panel" aria-label="Membership ID">
          <div className="membership-id-heading">
            <ShieldCheck size={22} />
            <div>
              <span>Membership ID</span>
              <h2>Wayfinder member pass</h2>
            </div>
          </div>
          <div className="wallet-qr-frame membership-qr-frame">
            <img
              alt="QR code for Wayfinder membership ID"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(membershipPayload)}`}
            />
          </div>
          <p>Use this QR code as your Wayfinder membership ID.</p>
        </aside>
      </section>
    </main>
  );
}
