import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import RootLayout from './app/layout';
import Home from './app/page';
import AdminPage from './app/admin/page';

const App = () => {
  const [path, setPath] = useState(() => {
    try {
      // In some blob/iframe contexts, pathname might be unreliable or empty
      const p = window.location.pathname;
      return p === 'blank' || !p ? '/' : p;
    } catch {
      return '/';
    }
  });

  // Handle browser back/forward buttons
  useEffect(() => {
    const onPopState = () => {
      try {
        setPath(window.location.pathname);
      } catch {
        // ignore errors in restricted environments
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Intercept all clicks on <a> tags for SPA navigation
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a');
      if (target) {
        const href = target.getAttribute('href');
        if (href && href.startsWith('/')) {
          e.preventDefault();
          // Update internal state for UI navigation
          setPath(href);
          
          // Try to update URL, but fail gracefully if blocked by sandbox/security
          try {
            window.history.pushState({}, '', href);
          } catch (err) {
            console.warn('Navigation URL update blocked by environment:', err);
          }
        }
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Simple Router
  let Component;
  if (path === '/admin') {
    Component = AdminPage;
  } else {
    Component = Home;
  }

  return (
    <RootLayout children={<Component />} />
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<App />);
}