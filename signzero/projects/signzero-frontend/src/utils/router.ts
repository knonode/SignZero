import { slugify } from './slugify'

export type Route =
  | { view: 'home' }
  | { view: 'create' }
  | { view: 'view'; appId: bigint }

export function parseRoute(pathname: string): Route {
  const segments = pathname.replace(/^\/+|\/+$/g, '').split('/')
  const first = segments[0]

  if (!first) return { view: 'home' }
  if (first === 'create') return { view: 'create' }

  try {
    const appId = BigInt(first)
    return { view: 'view', appId }
  } catch {
    return { view: 'home' }
  }
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new Event('pushstate'))
}

export function buildOpinionPath(appId: bigint, title: string): string {
  return `/${appId}/${slugify(title)}`
}
