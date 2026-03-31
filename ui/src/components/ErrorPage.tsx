import { Link } from "react-router";
import { tokens } from "../styles/tokens";

interface ErrorPageProps {
  error: Error;
}

export const ErrorPage: React.FC<ErrorPageProps> = ({ error }) => {
  return (
    <div className="bg-futures-app-bg min-h-screen px-4 py-16 sm:px-6 sm:py-24 md:grid md:place-items-center lg:px-8">
      <div className="max-w-max mx-auto">
        <main className="sm:flex">
          <div className="sm:ml-6">
            <div className="sm:border-l sm:border-futures-border sm:pl-6">
              <h1 className="text-5xl font-extrabold text-futures-text-primary tracking-tight sm:text-50">An error has occurred</h1>
              <h3 className="mt-1 text-base text-futures-text-secondary">{error.message}</h3>
            </div>
            <div className="mt-10 flex space-x-3 sm:border-l sm:border-transparent sm:pl-6">
              <Link style={{ color: tokens.error.link }} to="/">
                Return to Marketplace
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

ErrorPage.displayName = "ErrorPage";
