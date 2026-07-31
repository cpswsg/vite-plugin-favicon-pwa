// Convert an `oklch(L C H[ / A])` colour to an sRGB `rgb()`/`rgba()` string that
// sharp's colour parser and the PWA manifest both understand. Any other format
// (hex, rgb(), named, currentColor) is returned unchanged. L and C accept a
// number or a percentage (100% C = 0.4); H is degrees; `none` reads as 0.
export function oklchToRgb(color: string): string {
  const match = color.match(/^\s*oklch\(([^)]+)\)\s*$/i);
  if (!match) return color;

  const [coords, alphaRaw] = match[1].split('/');
  if (match[1].split('/').length > 2) throw new TypeError(`Invalid oklch() color: ${color}`);
  const [lRaw, cRaw, hRaw] = coords.trim().split(/[\s,]+/);
  if (coords.trim().split(/[\s,]+/).length !== 3) throw new TypeError(`Invalid oklch() color: ${color}`);

  const num = (raw: string | undefined, pctBase = 1) => {
    if (raw === 'none') return 0;
    const parsed = raw?.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(%)?$/i);
    if (!parsed) throw new TypeError(`Invalid oklch() color: ${color}`);
    const value = Number(parsed[1]);
    return parsed[2] ? (value / 100) * pctBase : value;
  };
  const angle = (raw: string | undefined) => {
    if (raw === 'none') return 0;
    const parsed = raw?.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i);
    if (!parsed) throw new TypeError(`Invalid oklch() color: ${color}`);
    const value = Number(parsed[1]);
    switch (parsed[2]?.toLowerCase()) {
      case 'grad': return (value * Math.PI) / 200;
      case 'rad': return value;
      case 'turn': return value * 2 * Math.PI;
      default: return (value * Math.PI) / 180;
    }
  };

  const L = Math.min(1, Math.max(0, num(lRaw)));
  const C = Math.max(0, num(cRaw, 0.4));
  const h = angle(hRaw);
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  // OKLab -> LMS -> linear sRGB (Björn Ottosson's reference matrices).
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  const gamma = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  };
  const [r, g, bl] = linear.map((v) => Math.round(gamma(v) * 255));
  const alpha = alphaRaw == null ? 1 : Math.min(1, Math.max(0, num(alphaRaw.trim())));
  return alpha < 1 ? `rgba(${r}, ${g}, ${bl}, ${alpha})` : `rgb(${r}, ${g}, ${bl})`;
}
