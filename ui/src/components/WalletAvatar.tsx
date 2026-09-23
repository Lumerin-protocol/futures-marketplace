type Props = {
  address: string;
  size?: number;
  className?: string;
};

/** Address-derived gradient disc, matching konekt-ui's account avatar. */
export const WalletAvatar = ({ address, size = 24, className }: Props) => {
  const seed = Number.parseInt(address.slice(2, 8), 16);
  const hue = Number.isNaN(seed) ? 210 : seed % 360;
  const background = [
    `radial-gradient(circle at 28% 24%, hsl(${(hue + 40) % 360} 95% 72%), transparent 62%)`,
    `linear-gradient(135deg, hsl(${hue} 88% 58%), hsl(${(hue + 300) % 360} 82% 46%))`,
  ].join(", ");

  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background,
        flexShrink: 0,
      }}
    />
  );
};
