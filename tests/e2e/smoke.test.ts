import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

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
