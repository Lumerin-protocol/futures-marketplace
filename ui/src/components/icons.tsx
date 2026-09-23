import type { ComponentType, CSSProperties, SVGProps } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  FlagIcon,
  ForwardIcon,
  QuestionMarkCircleIcon,
  ShieldCheckIcon,
  TrophyIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon as CheckCircleSolid, ExclamationCircleIcon } from "@heroicons/react/24/solid";

type FontSize = "inherit" | "small" | "medium" | "large" | string;

export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  fontSize?: FontSize;
  sx?: {
    fontSize?: number | string;
    color?: string;
    cursor?: string;
    verticalAlign?: string;
  };
};

const FONT_SIZE: Record<"inherit" | "small" | "medium" | "large", string> = {
  inherit: "1em",
  small: "1.25rem",
  medium: "1.5rem",
  large: "2.1875rem",
};

function sizeOf(fontSize: FontSize | undefined, sx?: IconProps["sx"], style?: CSSProperties) {
  if (sx?.fontSize != null) return sx.fontSize;
  if (style?.fontSize != null) return style.fontSize;
  if (fontSize && fontSize in FONT_SIZE) return FONT_SIZE[fontSize as keyof typeof FONT_SIZE];
  return fontSize ?? FONT_SIZE.medium;
}

/**
 * Material Design glyphs (MIT), inlined verbatim from @mui/icons-material so
 * the chart toggle renders exactly what it did before MUI was dropped.
 * Heroicons has no candlestick equivalent.
 */
const muiIcon = (path: string) => (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    {...props}
  >
    <path d={path} />
  </svg>
);

const CandlestickChart = muiIcon("M9 4H7v2H5v12h2v2h2v-2h2V6H9zm10 4h-2V4h-2v4h-2v7h2v5h2v-5h2z");
const ShowChart = muiIcon("m3.5 18.49 6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z");

function wrap(Hero: ComponentType<SVGProps<SVGSVGElement>>, displayName: string) {
  const Icon = ({ fontSize = "medium", sx, style, ...rest }: IconProps) => {
    const size = sizeOf(fontSize, sx, style);
    const color = sx?.color ?? style?.color ?? (typeof style?.fill === "string" ? style.fill : undefined);
    return (
      <Hero
        aria-hidden={rest["aria-label"] || rest["aria-labelledby"] ? undefined : true}
        {...rest}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          color,
          cursor: sx?.cursor,
          verticalAlign: sx?.verticalAlign,
          display: "inline-block",
          ...style,
          fill: undefined,
          fontSize: undefined,
        }}
      />
    );
  };
  Icon.displayName = displayName;
  return Icon;
}

export const CloseIcon = wrap(XMarkIcon, "CloseIcon");
export const ShowChartIcon = wrap(ShowChart, "ShowChartIcon");
export const EastIcon = wrap(ArrowRightIcon, "EastIcon");
export const OpenInNewIcon = wrap(ArrowTopRightOnSquareIcon, "OpenInNewIcon");
export const EmojiEventsOutlinedIcon = wrap(TrophyIcon, "EmojiEventsOutlinedIcon");
export const ArrowBackIcon = wrap(ArrowLeftIcon, "ArrowBackIcon");
export const HelpOutlineIcon = wrap(QuestionMarkCircleIcon, "HelpOutlineIcon");
export const HelpIcon = wrap(QuestionMarkCircleIcon, "HelpIcon");
export const CheckCircle = wrap(CheckCircleSolid, "CheckCircle");
export const SkipNext = wrap(ForwardIcon, "SkipNext");
export const ErrorIcon = wrap(ExclamationCircleIcon, "ErrorIcon");
export const FlagCircleIcon = wrap(FlagIcon, "FlagCircleIcon");
export const ShieldIcon = wrap(ShieldCheckIcon, "ShieldIcon");
export const CandlestickChartIcon = wrap(CandlestickChart, "CandlestickChartIcon");
