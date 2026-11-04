/**
 * CRITICAL PATH E2E TESTS — Jass Tour UI Kit
 * ============================================
 * Tests that the most fundamental user flows ACTUALLY WORK.
 * If these fail, the app is broken. CI MUST NOT use continue-on-error.
 *
 * Tests:
 * 1. Auth page loads, form is functional
 * 2. Edge functions: verify-jass-password reachable
 * 3. Protected routes: redirect works AND auth page is functional
 * 4. Supabase: project is alive, auth service healthy
 */

import { test, expect } from '@playwright/test'

import { BASE_URL } from './base-url'

// -- Project Config ----------------------------------------------------------

const CONFIG = {
  authPath: '/auth',
  supabaseUrl: process.env.VITE_SUPABASE_URL || 'https://uyksotlmrlxhmyeopktl.supabase.co',
  // Public client key (already committed in .env / shipped in the JS bundle)
  supabaseKey:
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    'sb_publishable_9RAQoEYJz6TuSOW9Z5E52g_vd7EmU1a',
  edgeFunctions: [
    'verify-jass-password',
  ],
  protectedRoutes: [
    '/session',
    '/history',
    '/rangliste',
    '/kasse',
    '/statuten',
    '/settings',
  ],
}

// PR checks are local-only. Live backend health coverage remains named @live below,
// for an explicitly authorised manual run; it must not run as a side effect of a PR.
if (process.env.OFFLINE_E2E === '1') {
  for (const value of [BASE_URL, CONFIG.supabaseUrl]) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
      throw new Error('Offline E2E requires loopback application and backend URLs')
    }
  }
}

test.beforeEach(async ({ context }) => {
  if (process.env.OFFLINE_E2E !== '1') return
  await context.route('**/*', route => {
    const host = new URL(route.request().url()).hostname
    return ['localhost', '127.0.0.1', '[::1]'].includes(host) ? route.continue() : route.abort()
  })
})

// -- Auth Page ---------------------------------------------------------------

test.describe('CRITICAL PATH — Auth Page', () => {
  test('auth page loads without JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto(CONFIG.authPath)
    await page.waitForLoadState('networkidle')

    expect(errors, `JS errors: ${errors.join(', ')}`).toEqual([])
  })

  test('auth page renders a form or login UI', async ({ page }) => {
    await page.goto(CONFIG.authPath)
    await page.waitForLoadState('networkidle')

    // Auth page should have some form of input
    const formElement = page.locator('input, button[type="submit"], form').first()
    await expect(formElement).toBeVisible({ timeout: 10000 })
  })
})

// -- Edge Function Health ----------------------------------------------------

test.describe('CRITICAL PATH — Edge Functions @live', () => {
  for (const funcName of CONFIG.edgeFunctions) {
    test(`"${funcName}" is reachable (not 500)`, async ({ request }) => {
      const response = await request.post(
        `${CONFIG.supabaseUrl}/functions/v1/${funcName}`,
        {
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({ _health_check: true }),
          failOnStatusCode: false,
        }
      )

      const status = response.status()
      expect(status, `"${funcName}" returned 500 — DOWN`).not.toBe(500)

      if (status === 401) {
        const body = await response.text()
        expect(
          body.includes('requires authorization token'),
          `"${funcName}" has verify_jwt incorrectly enabled`
        ).toBe(false)
      }
    })
  }
})

// -- Protected Routes --------------------------------------------------------

test.describe('CRITICAL PATH — Route Guards', () => {
  for (const route of CONFIG.protectedRoutes) {
    test(`${route} redirects to auth when unauthenticated`, async ({ page }) => {
      await page.goto(route)
      await page.waitForLoadState('networkidle')

      // Should redirect to /auth
      const url = page.url()
      const hasAuthRedirect = url.includes('/auth')
      const hasFormContent = await page.locator('input, form').first().isVisible().catch(() => false)

      expect(
        hasAuthRedirect || hasFormContent,
        `${route} did not redirect to auth — route guard may be broken`
      ).toBe(true)
    })
  }
})

// -- Infrastructure ----------------------------------------------------------

test.describe('CRITICAL PATH — Infrastructure', () => {
  test('Supabase auth service is healthy @live', async ({ request }) => {
    const response = await request.get(
      `${CONFIG.supabaseUrl}/auth/v1/health`,
      {
        headers: { apikey: CONFIG.supabaseKey },
        failOnStatusCode: false,
      }
    )
    expect(response.status()).toBe(200)
  })

  test('Supabase REST API is reachable @live', async ({ request }) => {
    const response = await request.get(
      `${CONFIG.supabaseUrl}/rest/v1/`,
      {
        headers: { apikey: 'test' },
        failOnStatusCode: false,
      }
    )
    expect(response.status()).toBeLessThan(500)
  })

  test('Selected application build is reachable', async ({ request }) => {
    const response = await request.get(BASE_URL, {
      failOnStatusCode: false,
    })
    expect(response.status()).toBeLessThan(500)
  })
})
