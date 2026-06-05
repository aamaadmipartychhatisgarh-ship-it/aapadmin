// Bucket call_statuses.name → high-level reporting categories.
// Spec uses categories like Connected / No Answer / Wrong Number / Busy / Switched Off / Rejected.
export const STATUS_BUCKETS = {
  connected: ["Phone Picked"],
  no_answer: ["Not Picked"],
  wrong_number: ["Wrong Number"],
  rejected: ["Rudely Behaved"],
  busy: ["Busy"],
  switched_off: ["Switched Off"],
};

export function bucketFor(statusName) {
  if (!statusName) return "other";
  for (const [bucket, names] of Object.entries(STATUS_BUCKETS)) {
    if (names.includes(statusName)) return bucket;
  }
  return "other";
}

export function tallyBuckets(calls) {
  const tally = {
    total: calls.length,
    connected: 0,
    no_answer: 0,
    wrong_number: 0,
    rejected: 0,
    busy: 0,
    switched_off: 0,
    other: 0,
  };
  for (const c of calls) {
    const bucket = bucketFor(c.status_name);
    tally[bucket]++;
  }
  return tally;
}

// "Online" if a user pinged the heartbeat in the last 2 minutes
export const LIVE_THRESHOLD_SECONDS = 120;
