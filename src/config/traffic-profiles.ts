import type { TrafficProfile } from "./run-config.js";

export const BALANCED_SOAK_PROFILE: TrafficProfile = {
  id: "balanced_soak",
  maxRuntimeMs: 60 * 60 * 1000,
  burstSize: 12,
  maxInFlight: 120,
  windowMs: 30_000,
  reconcileTimeoutMs: 120_000,
  writeTargetCount: 500,
  readTargetCount: 2_500,
  traceSampleRate: 0.2,
};

export function resolveTrafficProfile(
  profileId: TrafficProfile["id"],
  durationOverrideMs?: number,
): TrafficProfile {
  const profile =
    profileId === "balanced_soak" ? BALANCED_SOAK_PROFILE : BALANCED_SOAK_PROFILE;

  if (!durationOverrideMs) {
    return profile;
  }

  const ratio = Math.max(0.05, Math.min(1, durationOverrideMs / profile.maxRuntimeMs));

  return {
    ...profile,
    maxRuntimeMs: Math.min(profile.maxRuntimeMs, durationOverrideMs),
    writeTargetCount: Math.max(20, Math.floor(profile.writeTargetCount * ratio)),
    readTargetCount: Math.max(200, Math.floor(profile.readTargetCount * ratio)),
  };
}
