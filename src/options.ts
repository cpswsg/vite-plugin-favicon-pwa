/**
 * The option schema for the favicons-PWA plugin, its defaults, and the resolved
 * shape produced once the defaults are applied. Kept in one place so the entry
 * module (which merges user options with the defaults) and the asset generator
 * (which consumes the merged result) share a single source of truth.
 */
export interface FaviconsOptions {
  /** PWA manifest name. */
  name: string;
  /** Source SVG, relative to project root. */
  source?: string;
  /** Output folder for the generated assets, relative to the site root. */
  outDir?: string;
  /** Application root URL used by manifest id/start_url/scope, especially when Vite base points to a CDN. */
  appRoot?: string;
  /** Square canvas background (also the maskable icon background). */
  background?: string;
  /** Recolour the mark to this fill. Omit to keep the source colours. */
  foreground?: string;
  /** Mark inset on standard icons, as a fraction of the canvas (0-0.5). */
  padding?: number;
  /** Larger inset for the maskable icon's safe zone. */
  maskablePadding?: number;
  /** Favicon background corner radius as a fraction of the canvas (0 = square). Not applied to installable-app icons. */
  radius?: number;
  /** Additional PWA manifest fields. */
  shortName?: string;
  description?: string;
  themeColor?: string;
  /** `crossorigin` on the manifest link. Set `use-credentials` for a cookie-authed manifest. */
  manifestCrossOrigin?: 'anonymous' | 'use-credentials';
  /** Manifest language tag (BCP 47). */
  lang?: string;
  /** Base direction for localizable manifest strings. */
  dir?: 'ltr' | 'rtl' | 'auto';
}

export const DEFAULTS = {
  source: 'public/favicon.svg',
  outDir: 'assets/favicons',
  background: '#f7f3ea',
  padding: 0.1,
  maskablePadding: 0.3,
  radius: 0.18,
  themeColor: '#15110b',
  lang: 'en',
  dir: 'auto',
} satisfies Partial<FaviconsOptions>;

// The fully-resolved option shape: every defaulted field is present, plus the
// required name and purely-optional fields the generator reads. The entry module
// produces this by merging DEFAULTS with the user's options.
export type ResolvedFaviconsOptions = Omit<typeof DEFAULTS, 'dir'> &
  Pick<FaviconsOptions, 'name' | 'appRoot' | 'foreground' | 'shortName' | 'description'> & {
    dir: NonNullable<FaviconsOptions['dir']>;
  };
