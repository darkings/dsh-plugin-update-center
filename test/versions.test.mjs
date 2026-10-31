import test from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, gt, isPrerelease, parseVersion, satisfies } from '../lib/versions.js'

test('parses complete semantic versions', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] })
  assert.deepEqual(parseVersion('v0.2.1-rc.5'), { major: 0, minor: 2, patch: 1, prerelease: ['rc', '5'] })
  assert.deepEqual(parseVersion('2.0.0-alpha.1+build.7').prerelease, ['alpha', '1'])
  assert.equal(parseVersion('1.2'), null)
  assert.equal(parseVersion('not-a-version'), null)
  assert.equal(parseVersion(undefined), null)
})

test('orders versions with npm pre-release precedence', () => {
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1)
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
  assert.equal(compareVersions('2.0.0-alpha', '2.0.0'), -1)
  assert.equal(compareVersions('2.0.0-alpha.2', '2.0.0-alpha.10'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('0.2.1-rc.5', '0.3.0-0'), -1)
  assert.equal(gt('1.2.0', '1.0.0'), true)
  assert.equal(gt('1.0.0', '1.2.0'), false)
})

test('detects pre-release versions', () => {
  assert.equal(isPrerelease('1.0.0-rc.1'), true)
  assert.equal(isPrerelease('1.0.0'), false)
  assert.equal(isPrerelease('nope'), false)
})

test('evaluates the ranges DSH packages publish', () => {
  assert.equal(satisfies('0.2.1-rc.5', '>=0.2.0-rc.1 <0.3.0-0'), true)
  assert.equal(satisfies('0.3.0', '>=0.2.0-rc.1 <0.3.0-0'), false)
  assert.equal(satisfies('24.22.0', '^22.19.0 || >=24.0.0'), true)
  assert.equal(satisfies('22.0.0', '^22.19.0 || >=24.0.0'), false)
  assert.equal(satisfies('0.4.7', '^0.4.6'), true)
  assert.equal(satisfies('0.5.0', '^0.4.6'), false)
  assert.equal(satisfies('0.4.5', '^0.4.6'), false)
  assert.equal(satisfies('1.2.9', '~1.2.3'), true)
  assert.equal(satisfies('1.3.0', '~1.2.3'), false)
  assert.equal(satisfies('24.22.0', '>=22'), true)
  assert.equal(satisfies('2.7.1', '>=22'), false)
  assert.equal(satisfies('1.2.3', '1.2.3'), true)
  assert.equal(satisfies('1.2.4', '1.2.3'), false)
  assert.equal(satisfies('1.2.9', '1.2'), true)
  assert.equal(satisfies('1.4.0', '1.2'), false)
  assert.equal(satisfies('2.0.0', '1'), false)
  assert.equal(satisfies('1.2.3', '*'), true)
})

test('returns null for unsupported or absent ranges', () => {
  assert.equal(satisfies('1.2.3', 'workspace:*'), null)
  assert.equal(satisfies('1.2.3', '1.2.3 - 2.0.0'), null)
  assert.equal(satisfies('1.2.3', undefined), null)
  assert.equal(satisfies(undefined, '>=1.0.0'), false)
})
