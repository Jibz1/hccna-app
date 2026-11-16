/**
 * Strapi uploads to the CMS bucket keep their responsive variants alongside
 * the original: `<folder>/<file>` → `<folder>/<variant>_<file>`.
 * The GraphQL API only exposes the original (often full camera resolution,
 * up to 6000×4000 → ~92MB decoded RGBA per image), so callers rewrite the
 * URL client-side and fall back to the original via onError if a variant
 * is missing.
 */
const CMS_BUCKET_PREFIX = "https://storage.googleapis.com/app-hccnj/";

export type StrapiImageVariant = "thumbnail" | "small" | "medium" | "large";

const VARIANT_PREFIX_PATTERN = /^(thumbnail|small|medium|large)_/;

export function strapiImageVariantUrl(
  url: string,
  variant: StrapiImageVariant,
): string {
  if (!url.startsWith(CMS_BUCKET_PREFIX)) {
    return url;
  }

  const lastSlash = url.lastIndexOf("/");
  const fileName = url.slice(lastSlash + 1);
  if (fileName.length === 0 || VARIANT_PREFIX_PATTERN.test(fileName)) {
    return url;
  }

  return `${url.slice(0, lastSlash + 1)}${variant}_${fileName}`;
}
