export type Category = 'productive' | 'distracted' | 'neutral' | 'unknown'

export interface ClassificationResult {
  category: Category
  reason: string
}

const DISTRACTED_APPS = [
  'twitter', 'instagram', 'tiktok', 'snapchat', 'facebook', 'reddit',
  'discord', 'twitch', 'netflix', 'hulu', 'steam', 'chess', 'solitaire',
  'minecraft', 'fortnite', 'league of legends', 'youtube'
]

const PRODUCTIVE_APPS = [
  'code', 'cursor', 'xcode', 'intellij', 'pycharm', 'webstorm', 'android studio',
  'vim', 'neovim', 'emacs', 'terminal', 'iterm', 'warp', 'hyper', 'notion',
  'linear', 'jira', 'figma', 'slack', 'zoom', 'teams', 'word', 'excel',
  'powerpoint', 'pages', 'numbers', 'keynote'
]

const DISTRACTED_DOMAINS = [
  'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'snapchat.com',
  'facebook.com', 'reddit.com', 'discord.com', 'twitch.tv', 'netflix.com',
  'hulu.com', 'disneyplus.com', 'youtube.com', 'primevideo.com', '9gag.com',
  'buzzfeed.com'
]

const PRODUCTIVE_DOMAINS = [
  'github.com', 'gitlab.com', 'stackoverflow.com', 'notion.so', 'linear.app',
  'figma.com', 'docs.google.com', 'drive.google.com', 'jira', 'confluence',
  'vercel.com', 'anthropic.com', 'openai.com', 'huggingface.co', 'arxiv.org',
  'coursera.org', 'udemy.com', 'leetcode.com', 'hackerrank.com', 'npmjs.com',
  'crates.io', 'developer.apple.com', 'developer.android.com'
]

const BROWSER_APPS = ['google chrome', 'safari', 'arc', 'firefox', 'brave browser', 'opera', 'microsoft edge']

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function classify(appName: string, windowTitle: string, url?: string): ClassificationResult {
  const appLower = appName.toLowerCase()
  const titleLower = windowTitle.toLowerCase()

  // If we have a URL and it's a browser, classify by URL first
  if (url && BROWSER_APPS.some(b => appLower.includes(b))) {
    const domain = extractDomain(url)
    if (domain) {
      if (DISTRACTED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
        return { category: 'distracted', reason: domain }
      }
      if (PRODUCTIVE_DOMAINS.some(d => domain.includes(d))) {
        return { category: 'productive', reason: domain }
      }
    }
  }

  // Browser title-based classification (when URL not available)
  if (BROWSER_APPS.some(b => appLower.includes(b))) {
    if (titleLower.startsWith('reddit') || titleLower.includes('reddit -') || titleLower.includes('reddit:')) {
      return { category: 'distracted', reason: 'Reddit' }
    }
    if (titleLower.startsWith('twitter') || titleLower.includes('twitter /') || titleLower.includes('/ twitter')) {
      return { category: 'distracted', reason: 'Twitter' }
    }
    if (titleLower.includes('youtube')) {
      return { category: 'distracted', reason: 'YouTube' }
    }
  }

  // App name-based classification
  for (const app of DISTRACTED_APPS) {
    if (appLower.includes(app)) {
      return { category: 'distracted', reason: appName }
    }
  }

  for (const app of PRODUCTIVE_APPS) {
    if (appLower.includes(app)) {
      return { category: 'productive', reason: appName }
    }
  }

  // Browsers on their own are neutral unless we know the URL
  if (BROWSER_APPS.some(b => appLower.includes(b))) {
    return { category: 'neutral', reason: appName }
  }

  return { category: 'neutral', reason: appName }
}
