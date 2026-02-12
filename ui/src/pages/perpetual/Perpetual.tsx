import { type FC } from "react";
import { Futures } from "../futures/Futures";

export const Perpetual: FC = () => {
  return <Futures defaultMode="perpetual" />;
};
