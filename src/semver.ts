const SEMVER_PATTERN =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<buildmetadata>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
  buildMetadata: string;
}

/**
 * Parse a semantic version string. Returns undefined if invalid.
 */
export function parseSemver(version: string): SemanticVersion | undefined {
  if (!version) {
    return undefined;
  }

  const match = SEMVER_PATTERN.exec(version);
  if (!match || !match.groups) {
    return undefined;
  }

  const major = parseInt(match.groups["major"]!, 10);
  const minor = parseInt(match.groups["minor"]!, 10);
  const patch = parseInt(match.groups["patch"]!, 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    return undefined;
  }

  return {
    major,
    minor,
    patch,
    prerelease: match.groups["prerelease"] ?? "",
    buildMetadata: match.groups["buildmetadata"] ?? "",
  };
}

function isNumeric(s: string): boolean {
  return /^\d+$/.test(s);
}

function comparePreReleaseIdentifiers(id1: string, id2: string): number {
  if (isNumeric(id1) && isNumeric(id2)) {
    const num1 = parseInt(id1, 10);
    const num2 = parseInt(id2, 10);
    if (num1 < num2) return -1;
    if (num1 > num2) return 1;
    return 0;
  }

  if (isNumeric(id1)) return -1;
  if (isNumeric(id2)) return 1;

  if (id1 < id2) return -1;
  if (id1 > id2) return 1;
  return 0;
}

function comparePreRelease(pre1: string, pre2: string): number {
  if (pre1 === "" && pre2 === "") return 0;
  // A version without prerelease has higher precedence
  if (pre1 === "") return 1;
  if (pre2 === "") return -1;

  const ids1 = pre1.split(".");
  const ids2 = pre2.split(".");
  const minLen = Math.min(ids1.length, ids2.length);

  for (let i = 0; i < minLen; i++) {
    const cmp = comparePreReleaseIdentifiers(ids1[i]!, ids2[i]!);
    if (cmp !== 0) return cmp;
  }

  if (ids1.length < ids2.length) return -1;
  if (ids1.length > ids2.length) return 1;
  return 0;
}

/**
 * Compare two semantic versions.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareSemver(a: SemanticVersion, b: SemanticVersion): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return comparePreRelease(a.prerelease, b.prerelease);
}
