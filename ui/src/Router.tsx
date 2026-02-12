import { Suspense, type FC } from "react";
import { Route, Routes, Navigate } from "react-router";
import { safeLazy } from "./utils/safeLazy";

const SuspenseLayoutLazy = safeLazy(() =>
  import("./components/Layouts/SuspenseLayout").then((module) => ({
    default: module.SuspenseLayout,
  })),
);

const Futures = safeLazy(() => import("./pages/futures/Futures").then((module) => ({ default: module.Futures })));

export const Router: FC = () => {
  return (
    <Suspense>
      <Routes>
        {/* Default route - redirects to futures mode */}
        <Route
          path={"/"}
          element={
            <SuspenseLayoutLazy pageTitle="Lumerin Futures Marketplace">
              <Futures />
            </SuspenseLayoutLazy>
          }
        />
        {/* Perpetual trading mode */}
        <Route
          path={"/trade/perpetual"}
          element={
            <SuspenseLayoutLazy pageTitle="Lumerin Futures Marketplace">
              <Futures />
            </SuspenseLayoutLazy>
          }
        />
        {/* Expiring Futures trading mode */}
        <Route
          path={"/trade/futures"}
          element={
            <SuspenseLayoutLazy pageTitle="Lumerin Futures Marketplace">
              <Futures />
            </SuspenseLayoutLazy>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};
