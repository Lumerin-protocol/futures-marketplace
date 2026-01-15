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
        <Route
          path={"/"}
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
