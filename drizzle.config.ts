import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/core/database/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
})
