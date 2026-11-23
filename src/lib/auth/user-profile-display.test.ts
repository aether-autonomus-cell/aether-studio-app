import test from "node:test";
import assert from "node:assert/strict";
import { buildUserProfileDisplay } from "./user-profile-display.ts";

test("[UI/AUTH] mobile profile menu always exposes owner email and sign-out when auth is enabled", () => {
  const profile = buildUserProfileDisplay(
    {
      displayName: "Studio Owner",
      primaryEmail: "owner@example.com",
      isDevFallback: false,
    },
    { authEnabled: true, gateSession: false },
  );

  assert.equal(profile.displayLabel, "Studio Owner");
  assert.equal(profile.secondaryEmail, "owner@example.com");
  assert.equal(profile.initial, "S");
  assert.equal(profile.canSignOut, true);
  assert.equal(profile.sessionNote, "Verified Google owner session");
});

test("[UI/AUTH] local dev fallback preserves disabled-auth sign-out rule without hiding email", () => {
  const profile = buildUserProfileDisplay(
    {
      displayName: null,
      primaryEmail: "dev@local.invalid",
      isDevFallback: true,
    },
    { authEnabled: false, gateSession: false },
  );

  assert.equal(profile.displayLabel, "dev@local.invalid");
  assert.equal(profile.secondaryEmail, "dev@local.invalid");
  assert.equal(profile.canSignOut, false);
});
