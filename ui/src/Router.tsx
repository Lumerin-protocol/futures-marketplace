import { Suspense, type FC } from "react";
import { Route, Routes, Navigate } from "react-router";
import { safeLazy } from "./utils/safeLazy";
// Not lazy: this is just the header/footer/page-frame chrome (no chart/form
// deps), so importing it eagerly costs almost nothing but means it's already
// on screen the instant the app mounts — only the page body below
// (Futures/Leaderboard, which pull in charts, forms, etc.) needs its own
// loading state.
import { DefaultLayout } from "./components/Layouts/DefaultLayout";

const Futures = safeLazy(() => import("./pages/futures/Futures").then((module) => ({ default: module.Futures })));
const Leaderboard = safeLazy(() =>
  import("./pages/leaderboard/Leaderboard").then((module) => ({ default: module.Leaderboard })),
);

export const Router: FC = () => {
  return (
    // DefaultLayout (header/footer chrome) wraps everything *outside* the
    // Suspense boundary, so it paints immediately on mount and is never part
    // of any fallback. Only the route body below — Futures/Leaderboard,
    // which pull in charts/forms — is what suspends, and (no fallback given)
    // just renders nothing in that one spot until its chunk loads.
    <DefaultLayout>
      <Suspense>
        <Routes>
          {/* One trading element for both modes so futures↔perps only updates the
              URL param — remounting used to recreate Wagmi Hydrate mid-tree. */}
          <Route path="/trade/:mode" element={<Futures />} />
          <Route path="/" element={<Navigate to="/trade/futures" replace />} />
          <Route path="/futures" element={<Navigate to="/trade/futures" replace />} />
          <Route path="/perpetual" element={<Navigate to="/trade/perpetual" replace />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="*" element={<Navigate to="/trade/futures" replace />} />
        </Routes>
      </Suspense>
    </DefaultLayout>
  );
};
