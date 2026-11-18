import { collection, defineApi, defineConfig } from 'onedef'
import { z } from 'zod'

export const Song = z.object({ slug: z.string(), title: z.string() })
const config = defineConfig({ name: 'fixture' })
export const songs = collection(config, { name: 'songs', description: 'Songs.', id: 'slug', fields: Song })
export const contract = defineApi(config, { songs })
