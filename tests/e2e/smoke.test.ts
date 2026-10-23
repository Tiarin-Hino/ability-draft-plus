import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

test('statistics table headers update when switching between English and Chinese', async ({ playwright }, testInfo) => {
  const app = await playwright._electron.launch({
    args: [
      resolve(__dirname, '../../out/main/index.js'),
      `--user-data-dir=${testInfo.outputPath('user-data')}`,
    ],
  })
  try {
    const window = await app.firstWindow()
    await window
      .getByRole('navigation')
      .getByRole('button', { name: 'Abilities', exact: true })
      .click()
    await window.getByRole('button', { name: 'Language', exact: true }).click()
    await window.getByRole('menuitem', { name: /简体中文/ }).click()
    await expect(window.getByRole('columnheader')).toHaveText([
      '技能',
      '英雄',
      '胜率',
      '高分段胜率',
      '平均选取顺位',
      '终极技能',
    ])
    await window.getByRole('button', { name: '语言', exact: true }).click()
    await window.getByRole('menuitem', { name: /^English/ }).click()
    await expect(window.getByRole('columnheader')).toHaveText([
      'Ability',
      'Hero',
      'Win Rate',
      'HS Win Rate',
      'Pick Rate',
      'Ultimate',
    ])
    await window
      .getByRole('navigation')
      .getByRole('button', { name: 'Heroes', exact: true })
      .click()
    await window.getByRole('button', { name: 'Language', exact: true }).click()
    await window.getByRole('menuitem', { name: /简体中文/ }).click()
    await expect(window.getByRole('columnheader')).toHaveText([
      '英雄',
      '胜率',
      '高分段胜率',
      '平均选取顺位',
      '高分段平均选取顺位',
    ])
    await window.getByRole('button', { name: '语言', exact: true }).click()
    await window.getByRole('menuitem', { name: /^English/ }).click()
    await expect(window.getByRole('columnheader')).toHaveText([
      'Hero',
      'Win Rate',
      'HS Win Rate',
      'Pick Rate',
      'HS Pick Rate',
    ])
  } finally {
    await app.close()
  }
})

test('app launches and shows control panel', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js')],
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const title = await window.title()
  expect(title).toContain('Ability Draft Plus')

  await app.close()
})

test('stream server serves the board and SSE endpoint', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js')],
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Start the stream server through the same IPC surface the Streaming page uses
  const startResult = await window.evaluate(async () => {
    const api = (
      window as unknown as {
        electronApi: {
          invoke: (channel: string, args?: unknown) => Promise<unknown>
        }
      }
    ).electronApi
    return api.invoke('stream:start', { port: 58873 })
  })
  expect(startResult).toMatchObject({ success: true })

  // The board SPA is served from out/renderer
  const pageResponse = await fetch('http://127.0.0.1:58873/stream')
  expect(pageResponse.status).toBe(200)
  const html = await pageResponse.text()
  expect(html).toContain('Stream Board')

  // SSE endpoint pushes a versioned state envelope on connect
  const sseResponse = await fetch('http://127.0.0.1:58873/events', {
    headers: { Accept: 'text/event-stream' },
  })
  expect(sseResponse.status).toBe(200)
  expect(sseResponse.headers.get('content-type')).toContain('text/event-stream')
  const reader = sseResponse.body?.getReader()
  expect(reader).toBeDefined()
  const { value } = await reader!.read()
  const firstChunk = new TextDecoder().decode(value)
  expect(firstChunk).toContain('"type":"state"')
  expect(firstChunk).toContain('"phase":"waiting"')
  await reader!.cancel()

  await app.close()
})
