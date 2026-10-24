import { askJson } from './claude.ts'
import { CATEGORIES } from './types.ts'
import type { ActivityCategory } from './types.ts'

// Only reached for titles the desktop rules left as 'unknown'.

const SYSTEM = `You categorize what a student is doing from a desktop app name and window title.

Categories:
- coding: writing or debugging code, dev tools, programming Q&A
- notes: note-taking apps and note pages
- docs: writing or reading documents, PDFs, slides
- school: course sites, lectures, tutorials, and educational videos
- chat: messaging and group chats
- social: social media feeds and forums browsed for fun
- video: entertainment video and streams
- music: music apps and music videos
- unknown: genuinely can't tell from the title

Judge by the title's content, not just the site: a YouTube lecture is "school", a YouTube music video is "music", a YouTube vlog is "video".

Reply with only: {"category": "<one category>"}`

const cache = new Map<string, ActivityCategory>()

export async function categorizeUnknown(app: string, title: string): Promise<ActivityCategory> {
  const key = `${app}|${title}`
  const hit = cache.get(key)
  if (hit) return hit

  try {
    const out = await askJson(SYSTEM, `App: ${app}\nWindow title: ${title}`)
    const category = CATEGORIES.includes(out?.category as ActivityCategory)
      ? (out!.category as ActivityCategory)
      : 'unknown'
    cache.set(key, category)
    return category
  } catch (err) {
    console.error('[categorizeUnknown]', err instanceof Error ? err.message : err)
    return 'unknown' // not cached, so it's retried next time
  }
}
