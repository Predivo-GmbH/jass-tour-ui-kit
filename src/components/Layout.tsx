import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { Footer } from './Footer';

/** Announces route changes for screen readers in SPA navigation. */
function RouteAnnouncer() {
  const location = useLocation();
  const announcerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Read the first h1 on the page after navigation, or fall back to document.title
    const timer = setTimeout(() => {
      const h1 = document.querySelector('h1');
      const text = h1?.textContent || document.title || '';
      if (announcerRef.current) {
        announcerRef.current.textContent = text;
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return (
    <div
      ref={announcerRef}
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      className="sr-only"
    />
  );
}

export function Layout() {
  const location = useLocation();
 const isPasswordGate = location.pathname === '/auth';

  if (isPasswordGate) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Skip to content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Zum Inhalt springen
      </a>

      {/* Route announcer for SPA navigation */}
      <RouteAnnouncer />

      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:block lg:w-64 lg:border-r lg:bg-card" aria-label="Hauptnavigation">
        <Sidebar />
      </aside>

      {/* Main content */}
      <main id="main-content" className="pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-64">
        <div className="mx-auto max-w-2xl px-4 py-6 lg:max-w-4xl lg:px-8">
          <Outlet />
        </div>
        <Footer />
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Hauptnavigation">
        <BottomNav />
      </nav>
    </div>
  );
}
