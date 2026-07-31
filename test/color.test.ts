import { describe, it, expect } from 'vitest';
import { oklchToRgb } from '../src/color';

describe('oklchToRgb', () => {
  it('passes hex through unchanged', () => {
    expect(oklchToRgb('#f7f3ea')).toBe('#f7f3ea');
  });

  it('passes rgb()/rgba() through unchanged', () => {
    expect(oklchToRgb('rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)');
    expect(oklchToRgb('rgba(10, 20, 30, 0.5)')).toBe('rgba(10, 20, 30, 0.5)');
  });

  it('passes named colours and currentColor through', () => {
    expect(oklchToRgb('rebeccapurple')).toBe('rebeccapurple');
    expect(oklchToRgb('currentColor')).toBe('currentColor');
  });

  it('converts the achromatic extremes exactly', () => {
    expect(oklchToRgb('oklch(1 0 0)')).toBe('rgb(255, 255, 255)');
    expect(oklchToRgb('oklch(0 0 0)')).toBe('rgb(0, 0, 0)');
  });

  it('emits rgba() when alpha < 1', () => {
    expect(oklchToRgb('oklch(1 0 0 / 0.5)')).toBe('rgba(255, 255, 255, 0.5)');
  });

  it('drops alpha when it is 1', () => {
    expect(oklchToRgb('oklch(1 0 0 / 1)')).toBe('rgb(255, 255, 255)');
  });

  it('accepts percentage lightness and chroma', () => {
    expect(oklchToRgb('oklch(100% 0% 0)')).toBe('rgb(255, 255, 255)');
  });

  it('treats none as zero', () => {
    expect(oklchToRgb('oklch(1 none none)')).toBe('rgb(255, 255, 255)');
  });

  it('is case-insensitive on the function name', () => {
    expect(oklchToRgb('OKLCH(0 0 0)')).toBe('rgb(0, 0, 0)');
  });

  it('supports CSS hue angle units', () => {
    const degrees = oklchToRgb('oklch(0.7 0.15 180deg)');
    expect(oklchToRgb('oklch(0.7 0.15 0.5turn)')).toBe(degrees);
    expect(oklchToRgb(`oklch(0.7 0.15 ${Math.PI}rad)`)).toBe(degrees);
    expect(oklchToRgb('oklch(0.7 0.15 200grad)')).toBe(degrees);
  });

  it('rejects malformed oklch values with a useful error', () => {
    expect(() => oklchToRgb('oklch(nope 0 0)')).toThrow(/Invalid oklch/);
    expect(() => oklchToRgb('oklch(0.5 0.1)')).toThrow(/Invalid oklch/);
  });

  it('clamps CSS lightness and alpha values', () => {
    expect(oklchToRgb('oklch(200% 0 0 / 150%)')).toBe('rgb(255, 255, 255)');
    expect(oklchToRgb('oklch(-1 0 0 / -1)')).toBe('rgba(0, 0, 0, 0)');
  });

  it('converts a chromatic colour to a clamped sRGB triple', () => {
    const out = oklchToRgb('oklch(0.7 0.15 30)');
    expect(out).toMatch(/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
    const channels = out.match(/\d{1,3}/g)!.map(Number);
    expect(channels).toHaveLength(3);
    for (const c of channels) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
    // The 30deg hue is warm: red is the dominant channel.
    expect(channels[0]).toBeGreaterThan(channels[2]);
  });
});
