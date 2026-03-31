import type { FC, HTMLProps, PropsWithChildren } from "react";
import { PieChart, PieChartProps } from "react-minimal-pie-chart";
import { tokens } from "../styles/tokens";

type Props = PropsWithChildren<{
  progress: number;
  className?: string;
  color?: "default" | "error" | "success";
}>;

const segmentColors = {
  default: tokens.circularProgress.default,
  error: tokens.circularProgress.error,
  success: tokens.circularProgress.success,
};

export const CircularProgress: FC<Props> = (props) => {
  const { progress, color = "default" } = props;
  const lineWidth = 27;

  if (progress < 0 || progress > 1) {
    throw new Error(`Progress must be between 0 and 1: ${progress}`);
  }

  const data = [
    { value: progress, color: segmentColors[color] },
    { value: 1 - progress, color: tokens.circularProgress.track },
  ];

  return (
    <PieChart
      {...props}
      // segmentsStyle: optional per-segment stroke (gradient vs solid accent)
      data={data}
      totalValue={1}
      lineWidth={lineWidth}
      rounded={false}
      startAngle={-90}
    />
  );
};
