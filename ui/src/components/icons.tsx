import type { ComponentType, CSSProperties, SVGProps } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  ChartBarIcon,
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

/** Heroicons has no candlestick glyph, so draw one in its outline style. */
const CandlestickChart = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <title>Candlestick chart</title>
    <path d="M8 3v3.5m0 11V21" />
    <rect x={5.25} y={6.5} width={5.5} height={11} rx={1} />
    <path d="M16 3v6m0 7v5" />
    <rect x={13.25} y={9} width={5.5} height={7} rx={1} />
  </svg>
);

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
export const ShowChartIcon = wrap(ChartBarIcon, "ShowChartIcon");
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
