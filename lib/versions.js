/**
 * Minimal semantic-version helpers for the update checker.
 *
 * The plugin deliberately ships no runtime dependency: the profile is updated
 * from the official package manager, and a linked local bundle must stay
 * installable offline. These helpers cover the shapes npm packages put in
 * `version`, `engines.node`, `engines.dsh` and DSH peer ranges.
 *
 * Every parser returns `null` for an unsupported range instead of guessing, so
 * callers can treat the compatibility answer as unknown and let the official
 * plugin manager make the authoritative decision.
 */

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/
const RANGE_TOKEN_PATTERN = /^(>=|<=|>|<|=|\^|~)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/

/**
 * Parse a complete semantic version.
 * @param {unknown} value candidate version string
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[] } | null}
 */
export function parseVersion(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return null
  const match = VERSION_PATTERN.exec(value.trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * Whether a value is a complete semantic version.
 * @param {unknown} value candidate version
 * @returns {boolean}
 */
export function isVersion(value) {
  return parseVersion(value) !== null
}

/**
 * Whether a complete version carries a pre-release identifier.
 * @param {unknown} value candidate version
 * @returns {boolean}
 */
export function isPrerelease(value) {
  const parsed = parseVersion(value)
  return parsed !== null && parsed.prerelease.length > 0
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return Number(left) === Number(right) ? 0 : Number(left) < Number(right) ? -1 : 1
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * Compare two complete semantic versions using npm precedence rules.
 * @param {string | { major: number, minor: number, patch: number, prerelease: string[] }} left
 * @param {string | { major: number, minor: number, patch: number, prerelease: string[] }} right
 * @returns {-1 | 0 | 1 | null} null when either side is not a complete version
 */
export function compareVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : left
  const b = typeof right === 'string' ? parseVersion(right) : right
  if (!a || !b) return null
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  const ap = a.prerelease
  const bp = b.prerelease
  if (ap.length === 0 && bp.length === 0) return 0
  if (ap.length === 0) return 1
  if (bp.length === 0) return -1
  const length = Math.max(ap.length, bp.length)
  for (let index = 0; index < length; index += 1) {
    const first = ap[index]
    const second = bp[index]
    if (first === undefined) return -1
    if (second === undefined) return 1
    const order = compareIdentifier(first, second)
    if (order !== 0) return order
  }
  return 0
}

/**
 * Whether `left` is strictly greater than `right`.
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function gt(left, right) {
  return compareVersions(left, right) === 1
}

function versionOf(token) {
  const prerelease = token.prerelease === undefined ? [] : token.prerelease
  return {
    major: token.major,
    minor: token.minor === undefined ? 0 : token.minor,
    patch: token.patch === undefined ? 0 : token.patch,
    prerelease,
  }
}

function parsePartial(raw) {
  const match = RANGE_TOKEN_PATTERN.exec(raw)
  if (match === null) return null
  const operator = match[1] === undefined ? '' : match[1]
  const majorRaw = match[2]
  if (majorRaw === 'x' || majorRaw === 'X' || majorRaw === '*') return { operator, wildcard: true }
  const minorRaw = match[3]
  const patchRaw = match[4]
  const minorMissing = minorRaw === undefined || /^[xX*]$/.test(minorRaw)
  const patchMissing = patchRaw === undefined || /^[xX*]$/.test(patchRaw)
  return {
    operator,
    wildcard: false,
    major: Number(majorRaw),
    minor: minorMissing ? undefined : Number(minorRaw),
    patch: patchMissing ? undefined : Number(patchRaw),
    prerelease: match[5] === undefined ? [] : match[5].split('.'),
    minorMissing,
    patchMissing,
  }
}

function upperBound(partial, operator) {
  const { major, minor, patch, minorMissing, patchMissing } = partial
  if (operator === '^') {
    if (major !== 0) return { major: major + 1, minor: 0, patch: 0, prerelease: [] }
    if (!minorMissing && minor !== 0) return { major: 0, minor: minor + 1, patch: 0, prerelease: [] }
    return { major: 0, minor: 0, patch: (patchMissing ? 0 : patch) + 1, prerelease: [] }
  }
  // Tilde ranges keep the major (and the minor when it was written).
  if (!minorMissing) return { major, minor: minor + 1, patch: 0, prerelease: [] }
  return { major: major + 1, minor: 0, patch: 0, prerelease: [] }
}

function comparatorsFor(raw) {
  const partial = parsePartial(raw)
  if (partial === null) return null
  if (partial.wildcard) return []
  const { operator } = partial
  const lower = versionOf(partial)
  if (operator === '^' || operator === '~') return [
    { operator: '>=', version: lower },
    { operator: '<', version: upperBound(partial, operator) },
  ]
  if (operator === '>=' || operator === '>' || operator === '<=' || operator === '<') {
    return [{ operator, version: lower }]
  }
  // Bare and `=` ranges: a partial version means the npm wildcard interval.
  if (partial.minorMissing || partial.patchMissing) {
    const minorUpper = partial.minorMissing
      ? { major: partial.major + 1, minor: 0, patch: 0, prerelease: [] }
      : { major: partial.major, minor: partial.minor + 1, patch: 0, prerelease: [] }
    return [{ operator: '>=', version: lower }, { operator: '<', version: minorUpper }]
  }
  return [{ operator: '=', version: lower }]
}

function testComparator(version, comparator) {
  const order = compareVersions(version, comparator.version)
  if (order === null) return false
  switch (comparator.operator) {
    case '=': return order === 0
    case '>': return order > 0
    case '>=': return order >= 0
    case '<': return order < 0
    case '<=': return order <= 0
    default: return false
  }
}

/**
 * Evaluate a semver range against a complete version.
 *
 * Pre-release exclusion is not applied: DSH runs release-candidate builds and
 * the official compatibility check uses `includePrerelease`.
 *
 * @param {unknown} version complete installed/candidate version
 * @param {unknown} range npm range expression
 * @returns {boolean | null} null when the range is unsupported or a side is absent
 */
export function satisfies(version, range) {
  if (typeof range !== 'string' || range.trim() === '') return null
  const parsed = parseVersion(version)
  if (parsed === null) return false
  const alternatives = range.split('||').map((item) => item.trim()).filter((item) => item.length > 0)
  if (alternatives.length === 0) return null
  for (const alternative of alternatives) {
    const tokens = alternative.split(/\s+/).filter((item) => item.length > 0)
    if (tokens.length === 0) return null
    const comparators = []
    for (const token of tokens) {
      const parsedComparators = comparatorsFor(token)
      if (parsedComparators === null) return null
      comparators.push(...parsedComparators)
    }
    if (comparators.every((comparator) => testComparator(parsed, comparator))) return true
  }
  return false
}
