import { Predicate } from "effect";
/**
 * Semver comparison utilities for force-update version checking
 */

/**
 * Parses a version string into its components
 * @param version - Version string in format "major.minor.patch"
 * @returns Tuple of [major, minor, patch] numbers
 */
function parseVersion(version: string): [number, number, number] {
  const parts = version.split(".").map((part) => parseInt(part, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Validates that a version string follows semver format (x.y.z)
 * @param version - Version string to validate
 * @returns True if valid semver format
 */
export function isVersionValid(version: string): boolean {
  if (!version || !Predicate.isString(version)) {
    return false;
  }
  const semverRegex = /^\d+\.\d+\.\d+$/;
  return semverRegex.test(version);
}

/**
 * Compares two semver version strings
 * @param a - First version string
 * @param b - Second version string
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) {
    return aMajor < bMajor ? -1 : 1;
  }
  if (aMinor !== bMinor) {
    return aMinor < bMinor ? -1 : 1;
  }
  if (aPatch !== bPatch) {
    return aPatch < bPatch ? -1 : 1;
  }
  return 0;
}

/**
 * Checks if current version is less than required version
 * @param current - Current app version
 * @param required - Required minimum version
 * @returns True if current < required
 */
export function isVersionLessThan(current: string, required: string): boolean {
  return compareVersions(current, required) === -1;
}
