export const backgroundRefetchOpts = {
  refetchInterval: 15000, // 15 seconds
  refetchOnMount: false,
};

/** Keeps a range around long enough to survive browsing between periods. */
export const indexGcTimeMs = 60 * 60 * 1000;
