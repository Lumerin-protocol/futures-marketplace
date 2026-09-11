import React from "react";

if (process.env.NODE_ENV === "development") {
  const whyDidYouRender = await import("@welldone-software/why-did-you-render").then((m) => m.default);
  whyDidYouRender(React, {
    trackAllPureComponents: true,
    // `trackHooks: true` monkey-patches React.useSyncExternalStore and breaks
    // wagmi (`useChainId` -> `useSyncExternalStore`) with:
    //   "Cannot read properties of null (reading 'getSnapshot')"
    // Same incompatibility hits zustand/redux/react-router v7 — leave it off.
    trackHooks: false,
    logOnDifferentValues: true,
  });
}
