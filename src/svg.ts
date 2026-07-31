export type ViewBox = [number, number, number, number];

// viewBox: tolerate comma- or space-separated values and single quotes, and
// keep min-x/min-y so a non-zero origin isn't dropped. `label` names the source
// in error messages.
export function parseViewBox(raw: string, label: string): ViewBox {
  const viewBox = raw.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (!viewBox) throw new Error(`[vite-plugin-favicon-pwa] no viewBox in ${label}`);
  const values = viewBox[1].trim().split(/[\s,]+/).map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite)) {
    throw new Error(`[vite-plugin-favicon-pwa] invalid viewBox in ${label}`);
  }
  const [minX, minY, vbW, vbH] = values;
  if (!(vbW > 0) || !(vbH > 0)) throw new Error(`[vite-plugin-favicon-pwa] invalid viewBox in ${label}`);
  return [minX, minY, vbW, vbH];
}

// Layout attributes on the source root <svg> that the wrapper sets for itself,
// so they must not be carried over. Compared case-insensitively. Namespaced
// declarations like xmlns:xlink are deliberately kept so inner url(#id)/xlink
// references still resolve; only the default xmlns is dropped.
const LAYOUT_ATTRS = new Set(['xmlns', 'width', 'height', 'viewbox', 'x', 'y', 'preserveaspectratio']);

// The same geometry as CSS declarations. Carried in a `style`, these outrank the
// wrapper's presentation attributes and would override the computed dimensions
// (breaking padding/scaling), so they are filtered out of any carried style.
// (viewBox/preserveAspectRatio have no CSS-property form, so nothing to strip.)
const LAYOUT_STYLE_PROP = /^(?:width|height|x|y)\s*:/i;

function findRootOpen(raw: string): { end: number; tag: string } | undefined {
  const starts = /<svg\b/gi;
  let match: RegExpExecArray | null;
  while ((match = starts.exec(raw))) {
    const commentStart = raw.lastIndexOf('<!--', match.index);
    const commentEnd = raw.lastIndexOf('-->', match.index);
    if (commentStart > commentEnd) continue;

    let quote: '"' | "'" | undefined;
    for (let i = match.index; i < raw.length; i++) {
      const char = raw[i];
      if (quote) {
        if (char === quote) quote = undefined;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        return { end: i + 1, tag: raw.slice(match.index, i + 1) };
      }
    }
    return undefined;
  }
  return undefined;
}

// Drop layout declarations from a root style while keeping presentation ones
// (fill, stroke, ...). Returns the filtered declarations, or '' if none remain.
function filterLayoutStyle(style: string): string {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !LAYOUT_STYLE_PROP.test(d))
    .join('; ');
}

// Presentation attributes on the source root <svg> (fill, stroke, color,
// fill-rule, opacity, style, class, ...) inherit to the mark. They are lost when
// the outer <svg> is stripped, so return them as a serialized attribute string
// to carry onto the wrapper. Both quote styles are supported; layout attributes
// the wrapper owns are excluded, as are layout declarations inside a style.
export function extractRootAttrs(raw: string): string {
  const open = findRootOpen(raw)?.tag ?? '';
  const attrs: string[] = [];
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(open))) {
    const name = m[1];
    if (LAYOUT_ATTRS.has(name.toLowerCase())) continue;
    let value = m[2] ?? m[3] ?? '';
    if (name.toLowerCase() === 'style') {
      value = filterLayoutStyle(value);
      if (!value) continue;
    }
    const quote = value.includes('"') ? "'" : '"';
    attrs.push(`${name}=${quote}${value}${quote}`);
  }
  return attrs.join(' ');
}

// When the mark is being recoloured, an inherited root `fill` (as a `fill`
// attribute or a `fill:` declaration inside a carried `style`) must not survive
// to override the new colour. Strip both; the caller re-adds fill=foreground.
export function stripInheritedFill(attrs: string): string {
  return attrs
    .replace(/(^|\s)fill\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    // Quote-specific content match (like extractRootAttrs) so a single-quoted
    // style holding a double quote - style='fill:url("#g")' - still matches.
    .replace(/(style\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (_all, pre, dq, sq) => {
      const cleaned = (dq ?? sq)
        .replace(/\s*fill\s*:[^;]*;?/gi, '')
        .replace(/;\s*$/, '')
        .trim();
      if (!cleaned) return '';
      const quote = cleaned.includes('"') ? "'" : '"';
      return `${pre}${quote}${cleaned}${quote}`;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Inner markup of the source SVG: everything between the outer <svg> tags.
export function extractInner(raw: string): string {
  const open = findRootOpen(raw);
  if (!open) return raw;
  return raw.slice(open.end).replace(/<\/svg>\s*$/i, '');
}

// Swap the mark's actual fill(s) for `foreground` regardless of the source's
// original format - hex, rgb()/rgba(), oklch() (or any colour function), and
// keywords such as `currentColor`. `none` and url(...) paint references are
// preserved so holes and gradients survive. A replacer function is used so a
// `foreground` containing `$` is inserted literally.
export function recolorFills(inner: string, foreground: string): string {
  const marker = /(^|[\s;{"'])(fill\s*[:=]\s*["']?)/gim;
  let output = '';
  let cursor = 0;
  while (marker.exec(inner)) {
    const start = marker.lastIndex;
    let end = start;
    if (inner[start] === '#') {
      end = start + (inner.slice(start).match(/^#[0-9a-f]{3,8}/i)?.[0].length ?? 0);
    } else {
      const name = inner.slice(start).match(/^[a-z][\w-]*/i)?.[0];
      if (name) {
        end = start + name.length;
        if (inner[end] === '(') {
          let depth = 0;
          let quote: '"' | "'" | undefined;
          for (; end < inner.length; end++) {
            const char = inner[end];
            if (quote) {
              if (char === quote) quote = undefined;
            } else if (char === '"' || char === "'") {
              quote = char;
            } else if (char === '(') {
              depth++;
            } else if (char === ')' && --depth === 0) {
              end++;
              break;
            }
          }
        }
      }
    }
    if (end === start) continue;

    const value = inner.slice(start, end);
    output += inner.slice(cursor, start);
    output += /^none$|^url\(/i.test(value) ? value : foreground;
    cursor = end;
    marker.lastIndex = end;
  }
  return output + inner.slice(cursor);
}

export interface SquareSvgSpec {
  /** Inner markup of the source SVG (everything between its <svg> tags). */
  inner: string;
  /** Source viewBox [minX, minY, width, height]; the origin is carried onto the nested <svg>. */
  vb: ViewBox;
  /** Canvas edge length in pixels. */
  size: number;
  /** Background rect fill. */
  background: string;
  /** Mark inset as a fraction of the canvas (0-0.5). */
  padding: number;
  /** Serialized root presentation attributes (e.g. `fill="red" fill-rule="evenodd"`) carried onto the wrapper so the mark renders like the source. */
  innerAttrs: string;
  /** Background corner radius as a fraction of the canvas (0 = square). */
  radius?: number;
}

// Build a square SVG: a background rect with the source mark centred + padded.
// The source viewBox origin is carried onto the nested <svg> so a non-zero
// origin isn't dropped, and `innerAttrs` (the source root's presentation
// attributes) are carried onto the wrapper so the mark renders like the source.
export function squareSvg({ inner, vb, size, background, padding, innerAttrs, radius = 0 }: SquareSvgSpec): string {
  const [minX, minY, vbW, vbH] = vb;
  const avail = size * (1 - 2 * padding);
  const scale = Math.min(avail / vbW, avail / vbH);
  const w = vbW * scale;
  const h = vbH * scale;
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  const attrs = innerAttrs ? ` ${innerAttrs}` : '';
  const rx = radius ? ` rx="${size * radius}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}"${rx} fill="${background}"/>` +
    `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${minX} ${minY} ${vbW} ${vbH}"${attrs}>${inner}</svg>` +
    `</svg>`
  );
}
