import "./wdyr";
import "./fonts.css";
import "./index.css";

import React, { type ErrorInfo } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { ErrorPage } from "./components/ErrorPage";
import { createRoot } from "react-dom/client";

const ErrorFallback = ({ error }: FallbackProps) => {
  return <ErrorPage error={error instanceof Error ? error : new Error(String(error))} />;
};

const errorHandler = (_error: unknown, _info: ErrorInfo) => {};

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Failed to find the root element");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary fallbackRender={ErrorFallback} onError={errorHandler}>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
