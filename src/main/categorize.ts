// Rules + cache that turn the raw app/title/url into an activity category.
// Anything the rules can't place stays 'unknown' and goes to the AI worker.

export type ActivityCategory =
  | 'coding' | 'notes' | 'docs' | 'school' | 'chat'
  | 'social' | 'video' | 'music' | 'unknown'

// Matched case-insensitively against the app name ("contains"), first hit wins.
const APP_RULES: [string, ActivityCategory][] = [
  ['visual studio code', 'coding'], ['code', 'coding'], ['cursor', 'coding'],
  ['terminal', 'coding'], ['iterm', 'coding'], ['warp', 'coding'], ['xcode', 'coding'],
  ['notion', 'notes'], ['notability', 'notes'], ['obsidian', 'notes'], ['goodnotes', 'notes'],
  ['microsoft word', 'docs'], ['pages', 'docs'], ['preview', 'docs'],
  ['messages', 'chat'], ['discord', 'chat'], ['slack', 'chat'],
  ['spotify', 'music']
]

// Matched against the browser URL and window title. YouTube is deliberately
// absent: lecture vs. procrastination is the AI's call.
const SITE_RULES: [RegExp, ActivityCategory][] = [
  [/instagram|tiktok|twitter|x\.com|reddit|facebook/i, 'social'],
  [/netflix|twitch|hulu|disneyplus/i, 'video'],
  [/docs\.google|notion/i, 'docs'],
  [/github|stack ?overflow|localhost/i, 'coding'],
  [/canvas|gradescope|piazza|ed discussion|edstem/i, 'school']
]

const MAX_CACHE = 500
const cache = new Map<string, ActivityCategory>()

export function categorize(app: string, title: string, url = ''): ActivityCategory {
  const key = `${app}|${title}|${url}`
  const hit = cache.get(key)
  if (hit) return hit

  const appLower = app.toLowerCase()
  let category = APP_RULES.find(([name]) => appLower.includes(name))?.[1]
  if (!category) {
    const text = `${url} ${title}`
    category = SITE_RULES.find(([re]) => re.test(text))?.[1] ?? 'unknown'
  }

  if (cache.size >= MAX_CACHE) cache.clear()
  cache.set(key, category)
  return category
}
