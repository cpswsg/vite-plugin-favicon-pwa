import { describe, it, expect } from 'vitest';
import { parseViewBox, extractRootAttrs, stripInheritedFill, extractInner, recolorFills, squareSvg } from '../src/svg';

describe('parseViewBox', () => {
  it('parses space-separated values', () => {
    expect(parseViewBox('<svg viewBox="0 0 24 24">', 'x')).toEqual([0, 0, 24, 24]);
  });

  it('parses comma-separated values', () => {
    expect(parseViewBox('<svg viewBox="0,0,24,24">', 'x')).toEqual([0, 0, 24, 24]);
  });

  it('accepts single quotes', () => {
    expect(parseViewBox("<svg viewBox='0 0 24 24'>", 'x')).toEqual([0, 0, 24, 24]);
  });

  it('keeps a non-zero origin', () => {
    expect(parseViewBox('<svg viewBox="-8 -8 16 16">', 'x')).toEqual([-8, -8, 16, 16]);
  });

  it('accepts scientific notation', () => {
    expect(parseViewBox('<svg viewBox="-1e1 2e1 1e3 5e2">', 'x')).toEqual([-10, 20, 1000, 500]);
  });

  it('rejects a viewBox that does not contain exactly four finite numbers', () => {
    expect(() => parseViewBox('<svg viewBox="0 0 24 24 99">', 'x')).toThrow(/invalid viewBox/);
    expect(() => parseViewBox('<svg viewBox="0 0 nope 24">', 'x')).toThrow(/invalid viewBox/);
  });

  it('throws when viewBox is missing', () => {
    expect(() => parseViewBox('<svg>', 'logo.svg')).toThrow(/no viewBox in logo\.svg/);
  });

  it('throws when a dimension is non-positive', () => {
    expect(() => parseViewBox('<svg viewBox="0 0 0 24">', 'logo.svg')).toThrow(/invalid viewBox/);
  });
});

describe('extractRootAttrs', () => {
  it('carries presentation attributes and drops layout ones', () => {
    const attrs = extractRootAttrs('<svg viewBox="0 0 24 24" width="24" height="24" fill="red" fill-rule="evenodd"><path/></svg>');
    expect(attrs).toBe('fill="red" fill-rule="evenodd"');
  });

  it('preserves a style attribute', () => {
    expect(extractRootAttrs('<svg style="fill-rule:evenodd"><path/></svg>')).toBe('style="fill-rule:evenodd"');
  });

  it('strips layout declarations from a carried style but keeps presentation ones', () => {
    expect(extractRootAttrs('<svg style="width:24px;height:24px;fill:red"><path/></svg>')).toBe('style="fill:red"');
  });

  it('drops a style that held only layout declarations', () => {
    expect(extractRootAttrs('<svg style="width:24px;height:24px"><path/></svg>')).toBe('');
  });

  it('does not mistake stroke-width for a layout declaration', () => {
    expect(extractRootAttrs('<svg style="stroke-width:2;fill:red"><path/></svg>')).toBe('style="stroke-width:2; fill:red"');
  });

  it('supports single-quoted attributes', () => {
    expect(extractRootAttrs("<svg fill='red' stroke='blue'><path/></svg>")).toBe('fill="red" stroke="blue"');
  });

  it('drops the default xmlns but keeps namespaced declarations', () => {
    const attrs = extractRootAttrs(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" fill="red"><use/></svg>',
    );
    expect(attrs).toBe('xmlns:xlink="http://www.w3.org/1999/xlink" fill="red"');
  });

  it('excludes preserveAspectRatio, x and y', () => {
    expect(extractRootAttrs('<svg preserveAspectRatio="xMidYMid" x="1" y="2" fill="red"><path/></svg>')).toBe('fill="red"');
  });

  it('switches to single quotes when the value contains a double quote', () => {
    expect(extractRootAttrs('<svg style=\'fill:url("#g")\'><path/></svg>')).toBe('style=\'fill:url("#g")\'');
  });

  it('returns an empty string when the root has no carryable attributes', () => {
    expect(extractRootAttrs('<svg viewBox="0 0 1 1"><path/></svg>')).toBe('');
  });

  it('handles a greater-than sign inside a quoted root attribute', () => {
    expect(extractRootAttrs('<svg aria-label="a > b" fill="red"><path/></svg>')).toBe(
      'aria-label="a > b" fill="red"',
    );
  });
});

describe('stripInheritedFill', () => {
  it('removes a fill attribute but keeps others', () => {
    expect(stripInheritedFill('fill="red" stroke="blue"')).toBe('stroke="blue"');
  });

  it('does not touch fill-rule', () => {
    expect(stripInheritedFill('fill="red" fill-rule="evenodd"')).toBe('fill-rule="evenodd"');
  });

  it('removes a fill declaration from a style, keeping the rest', () => {
    expect(stripInheritedFill('style="fill:red;stroke:blue"')).toBe('style="stroke:blue"');
  });

  it('drops a style that held only fill', () => {
    expect(stripInheritedFill('style="fill:red"')).toBe('');
  });

  it('handles a single-quoted style whose value contains a double quote', () => {
    expect(stripInheritedFill('style=\'fill:url("#g"); stroke:red\'')).toBe('style="stroke:red"');
  });

  it('drops a single-quoted style that held only a quoted-url fill', () => {
    expect(stripInheritedFill('style=\'fill:url("#g")\'')).toBe('');
  });
});

describe('extractInner', () => {
  it('strips the outer svg tags', () => {
    expect(extractInner('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>')).toBe('<path d="M0 0"/>');
  });

  it('trims trailing whitespace after the closing tag', () => {
    expect(extractInner('<svg><g/></svg>\n')).toBe('<g/>');
  });

  it('ignores svg-like text in a leading comment and quoted greater-than signs', () => {
    const raw = '<!-- <svg bogus> --><svg aria-label="a > b"><g/></svg>';
    expect(extractInner(raw)).toBe('<g/>');
  });
});

describe('recolorFills', () => {
  it('swaps hex attribute fills for the foreground', () => {
    expect(recolorFills('<path fill="#abc"/>', '#123456')).toBe('<path fill="#123456"/>');
  });

  it('swaps style-property fills', () => {
    expect(recolorFills('<path style="fill:#abcdef"/>', 'red')).toBe('<path style="fill:red"/>');
  });

  it('preserves fill:none', () => {
    expect(recolorFills('<path fill="none"/>', '#123456')).toBe('<path fill="none"/>');
  });

  it('preserves url(...) paint references', () => {
    expect(recolorFills('<path fill="url(#g)"/>', '#123456')).toBe('<path fill="url(#g)"/>');
  });

  it('swaps oklch and other function-form fills', () => {
    expect(recolorFills('<path fill="oklch(0.5 0.1 30)"/>', '#123456')).toBe('<path fill="#123456"/>');
  });

  it('inserts a foreground containing $ literally', () => {
    expect(recolorFills('<path fill="#abc"/>', '$&broken')).toBe('<path fill="$&broken"/>');
  });

  it('does not alter similarly named attributes or custom properties', () => {
    const source = '<path data-fill="red" style="--fill:blue; fill:green"/>';
    expect(recolorFills(source, '#123456')).toBe(
      '<path data-fill="red" style="--fill:blue; fill:#123456"/>',
    );
  });

  it('recolors hyphenated and nested color functions', () => {
    expect(recolorFills('<path fill="color-mix(in srgb, red, blue)"/>', '#123456')).toBe(
      '<path fill="#123456"/>',
    );
    expect(recolorFills('<path style="fill:rgb(from red calc(r / 2) g b)"/>', '#123456')).toBe(
      '<path style="fill:#123456"/>',
    );
  });
});

describe('squareSvg', () => {
  it('produces a square canvas of the requested size', () => {
    const out = squareSvg({ inner: '<path/>', vb: [0, 0, 10, 10], size: 512, background: '#fff', padding: 0.1, innerAttrs: '' });
    expect(out).toContain('width="512" height="512"');
    expect(out).toContain('viewBox="0 0 512 512"');
  });

  it('adds a background rect with the given fill', () => {
    const out = squareSvg({ inner: '<path/>', vb: [0, 0, 10, 10], size: 100, background: '#abc', padding: 0, innerAttrs: '' });
    expect(out).toContain('<rect width="100" height="100" fill="#abc"/>');
  });

  it('applies a corner radius only when radius > 0', () => {
    const rounded = squareSvg({ inner: '<path/>', vb: [0, 0, 10, 10], size: 100, background: '#abc', padding: 0, innerAttrs: '', radius: 0.2 });
    expect(rounded).toContain('rx="20"');
    const square = squareSvg({ inner: '<path/>', vb: [0, 0, 10, 10], size: 100, background: '#abc', padding: 0, innerAttrs: '' });
    expect(square).not.toContain('rx=');
  });

  it('centres and scales the inner mark to honour padding', () => {
    // size 100, padding 0.1 -> available 80; a 10x10 viewBox scales x8 to 80x80,
    // centred at x=y=10.
    const out = squareSvg({ inner: '<path/>', vb: [0, 0, 10, 10], size: 100, background: '#fff', padding: 0.1, innerAttrs: '' });
    expect(out).toContain('x="10" y="10" width="80" height="80" viewBox="0 0 10 10"');
  });

  it('carries the root attributes onto the wrapper', () => {
    const out = squareSvg({ inner: '<path/>', vb: [0, 0, 10, 10], size: 100, background: '#fff', padding: 0, innerAttrs: 'fill="red" fill-rule="evenodd"' });
    expect(out).toContain('viewBox="0 0 10 10" fill="red" fill-rule="evenodd">');
  });

  it('embeds the inner markup', () => {
    const out = squareSvg({ inner: '<circle r="1"/>', vb: [0, 0, 10, 10], size: 100, background: '#fff', padding: 0, innerAttrs: '' });
    expect(out).toContain('<circle r="1"/></svg></svg>');
  });
});
