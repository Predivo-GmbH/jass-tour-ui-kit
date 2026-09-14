/**
 * auth-captcha-token.test.tsx — proves the client half of the sign-in bot-protection fix on
 * Beize Jass Tour. Direct port of ReplyFlow's src/test/auth-captcha-token.test.tsx, adapted to
 * this app's shape: src/pages/Auth.tsx holds captchaToken as local component state (this app has
 * no AuthContext), and the only two GoTrue endpoints this client calls are signInWithPassword and
 * signUp — there is no signInWithOtp or resetPasswordForEmail call anywhere in this app (verified
 * by grep across src/ before this fix; see the PR body).
 *
 * THE VULNERABILITY (measured live 2026-09-14): Auth.tsx called supabase.auth.signInWithPassword
 * and supabase.auth.signUp with no challenge token, so anyone on the internet could hit GoTrue's
 * /token and /signup (and /otp, /recover — same project-wide captcha gate, not called by this
 * client but affected once enabled) with no proof of a human.
 *
 * The fix threads a Cloudflare Turnstile captchaToken through both calls via options.captchaToken,
 * the exact field GoTrue checks. This suite proves the WIRING is correct — it does NOT prove
 * server enforcement, which is a separate Supabase Auth-settings switch (Roger's gate) proven live
 * by scripts/signin-captcha.prod.test.mjs, which is RED until that switch is flipped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect, forwardRef, useImperativeHandle } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const TOKEN = 'turnstile-token-abc123'

// Full auth mock with spies for the two methods under test.
const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn().mockResolvedValue({ data: null, error: null }),
  signUp: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
}))
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth,
    from: vi.fn(),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}))

// TurnstileWidget's real behavior (loading the Cloudflare script into an iframe) isn't
// jsdom-testable and isn't what this suite exists to prove — that is covered by the widget
// rendering nothing when VITE_TURNSTILE_SITE_KEY is unset (see TurnstileWidget.tsx). Here it
// hands back a fixed token immediately so Auth.tsx's threading can be asserted deterministically.
vi.mock('@/components/TurnstileWidget', () => ({
  default: forwardRef<{ reset: () => void }, { onToken: (t: string | null) => void }>(
    ({ onToken }, ref) => {
      useEffect(() => { onToken(TOKEN) }, [onToken])
      useImperativeHandle(ref, () => ({ reset: () => onToken(null) }), [onToken])
      return null
    },
  ),
}))

vi.mock('@/hooks/usePlayers', () => ({
  usePlayers: () => ({ data: [{ id: 'p1', name: 'Alice', created_at: '' }] }),
}))

// Radix Select needs DOM APIs jsdom does not implement (hasPointerCapture, scrollIntoView) and
// its internals are not what this suite exists to prove. Swap it for a plain native <select> so
// the player-choice path in handleSignup can be driven with a single deterministic fireEvent.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select aria-label="Spieler wählen" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}))

import Auth from '@/pages/Auth'

function renderAuth() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  auth.signInWithPassword.mockClear()
  auth.signUp.mockClear()
})

describe('Auth.tsx forwards the Turnstile captchaToken to Supabase', () => {
  it('signInWithPassword passes captchaToken (the /token endpoint)', async () => {
    renderAuth()
    // Radix Tabs activates on mousedown, not click — see @radix-ui/react-tabs's Trigger.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Login' }), { button: 0 })
    // Placeholder text, not label text: the "Passwort" aria-label collides with the "Passwort"
    // shared-password TAB'S own name — each TabsContent panel carries aria-labelledby pointing at
    // its trigger, so getByLabelText('Passwort') also matches the (empty, inactive) password-tab
    // panel via that trigger's text. Placeholder text only targets the real <input>.
    fireEvent.change(screen.getByPlaceholderText('E-Mail'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Passwort'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))

    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalled())
    expect(auth.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        password: 'secret123',
        options: expect.objectContaining({ captchaToken: TOKEN }),
      }),
    )
  })

  it('handleSignup rejects with no player chosen, before ever reaching supabase.auth.signUp', async () => {
    renderAuth()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Registrieren' }), { button: 0 })
    fireEvent.change(screen.getByPlaceholderText('E-Mail'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Passwort (min. 6 Zeichen)'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrieren' }))

    await waitFor(() => expect(screen.getByText('Bitte wähle deinen Spieler')).toBeInTheDocument())
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('signUp passes captchaToken when a player is selected', async () => {
    renderAuth()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Registrieren' }), { button: 0 })
    fireEvent.change(screen.getByPlaceholderText('E-Mail'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Passwort (min. 6 Zeichen)'), { target: { value: 'secret123' } })
    fireEvent.change(screen.getByLabelText('Spieler wählen'), { target: { value: 'p1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Registrieren' }))

    await waitFor(() => expect(auth.signUp).toHaveBeenCalled())
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new@example.com',
        password: 'secret123',
        options: expect.objectContaining({ captchaToken: TOKEN }),
      }),
    )
  })
})
