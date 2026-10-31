import test from 'node:test'
import assert from 'node:assert/strict'

const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
}

test('client module registers the sidebar footer action', async () => {
  let registration = null
  const effects = []
  const slots = []
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch

  globalThis.window = { __ModuleLoader__: { load(value) { registration = value } } }
  globalThis.document = { baseURI: 'http://127.0.0.1:58808/' }
  globalThis.fetch = async () => { throw new Error('offline') }

  try {
    await import('../client.js')
    assert.ok(registration, 'module registers itself')
    assert.equal(registration.id, 'dsh-plugin-updates')

    const client = registration.factory((specifier) => {
      if (specifier === 'react') return React
      if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {}
      throw new Error('unexpected module ' + specifier)
    })

    assert.deepEqual(client.inject, ['slots', 'locale'])

    const ctx = {
      locale: {
        register: () => () => {},
        bind: () => (key) => key,
        subscribe: () => () => {},
        getSnapshot: () => ({ active: 'zh' }),
      },
      slots: {
        inject: (name, callback) => {
          assert.equal(name, 'sidebar.footer.action')
          callback()
        },
        register: (options, component) => {
          slots.push({ options, component })
          return () => {}
        },
      },
      effect: (callback) => {
        const dispose = callback()
        effects.push(dispose)
        return dispose
      },
    }

    client.apply(ctx)

    assert.equal(slots.length, 1)
    assert.equal(slots[0].options.name, 'sidebar.footer.action')
    assert.equal(slots[0].options.id, 'dsh-plugin-updates')
    assert.equal(typeof slots[0].component, 'function')

    for (const dispose of effects) if (typeof dispose === 'function') dispose()
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})
