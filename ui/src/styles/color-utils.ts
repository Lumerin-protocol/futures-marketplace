/**
 * CSS color → rgba(), same job MUI's `alpha()` did.
 */
export function alpha(color: string, opacity: number): string {
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .slice(0, 3)
        .split("")
        .map((c) => c + c)
        .join("");
    } else {
      hex = hex.slice(0, 6);
    }
    const n = Number.parseInt(hex, 16);
    if (Number.isNaN(n)) return color;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  const parts = color.match(/\d+(\.\d+)?/g);
  if (!parts || parts.length < 3) return color;
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${opacity})`;
}
