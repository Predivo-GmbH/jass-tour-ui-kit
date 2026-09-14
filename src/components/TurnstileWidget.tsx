import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'

// Cloudflare Turnstile SITE KEY — public by design (safe to embed), but this fleet holds no
// Cloudflare API token right now, so no key has been minted for this product yet. Read it from
// the environment instead of hardcoding one (deliberate deviation from the ReplyFlow reference,
// which hardcodes its site key — see the PR body). When VITE_TURNSTILE_SITE_KEY is unset this
// widget renders nothing and never produces a token, which keeps the whole captcha-token change a
// no-op until both a site key AND the server-side Auth setting are in place.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export interface TurnstileHandle {
  reset: () => void
}

interface TurnstileWidgetProps {
  /** Called with a token on success, or null on load/expire/error. */
  onToken: (token: string | null) => void
}

/**
 * Cloudflare Turnstile widget (Managed mode — mostly invisible for legit users).
 * Produces a single-use token; call reset() after each use to get a fresh one.
 *
 * Renders nothing and never calls onToken when VITE_TURNSTILE_SITE_KEY is not configured — see
 * the SITE_KEY comment above.
 */
const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(({ onToken }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetIdRef.current)
        } catch {
          /* widget already gone — ignore */
        }
        onToken(null)
      }
    },
  }), [onToken])

  useEffect(() => {
    if (!SITE_KEY) return // no site key configured — stay a no-op, never render, never call onToken
    let cancelled = false

    function renderWidget() {
      if (cancelled || !window.turnstile || !containerRef.current || widgetIdRef.current) return
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        callback: (token: string) => onToken(token),
        'error-callback': () => onToken(null),
        'expired-callback': () => onToken(null),
      })
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
      if (!script) {
        script = document.createElement('script')
        script.src = SCRIPT_SRC
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
      script.addEventListener('load', renderWidget)
    }

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null
      }
    }
  }, [onToken])

  if (!SITE_KEY) return null

  // overflow-x-auto: the Turnstile iframe is a fixed 300px; on narrow phones it would
  // otherwise push the page wider than the viewport.
  return <div ref={containerRef} className="min-h-[65px] overflow-x-auto" />
})

TurnstileWidget.displayName = 'TurnstileWidget'
export default TurnstileWidget
