import { useState, useEffect } from 'react'
import { parseRoute, type Route } from '../utils/router'

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname))

  useEffect(() => {
    const handler = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', handler)
    window.addEventListener('pushstate', handler)
    return () => {
      window.removeEventListener('popstate', handler)
      window.removeEventListener('pushstate', handler)
    }
  }, [])

  return route
}
