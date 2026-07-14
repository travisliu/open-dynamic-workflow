import { Outlet, NavLink, useLocation } from "react-router-dom";
import { useState } from "react";

const GITHUB_URL = "https://github.com/travisliu/open-dynamic-workflow";
const NPM_URL = "https://www.npmjs.com/package/@travisliu/open-dynamic-workflow";

function GitHubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function NpmIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.668h5.331v5.33zm4 0v1.336H8.001V8.668h5.334v5.332h-2.669zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.668h8.002v5.33zM10.665 10H12v2.664h-1.335V10z" />
    </svg>
  );
}

export default function Layout() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isDocsPage =
    location.pathname.startsWith("/guides") ||
    location.pathname.startsWith("/reference");

  return (
    <div className="app-shell" style={{ flexDirection: "column" }}>
      {/* Topbar */}
      <header className="topbar">
        <NavLink to="/" className="topbar-brand">
          <span className="brand-icon">
            <i />
          </span>
          Open Dynamic Workflow
        </NavLink>

        <nav className="topbar-nav" aria-label="Primary navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Home
          </NavLink>
          <NavLink
            to="/guides"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Guides
          </NavLink>
          <NavLink
            to="/reference"
            className={() =>
              location.pathname.startsWith("/reference") ? "active" : ""
            }
          >
            Reference
          </NavLink>

        </nav>

        <div className="topbar-actions">
          <a
            href={GITHUB_URL}
            className="topbar-link"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="View on GitHub"
          >
            <GitHubIcon />
            GitHub
          </a>
          <a
            href={NPM_URL}
            className="topbar-link"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="View on npm"
          >
            <NpmIcon />
            npm
          </a>
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? "✕" : "☰"}
          </button>
        </div>
      </header>

      {/* Mobile nav overlay */}
      {mobileMenuOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "rgba(0,0,0,0.3)",
          }}
          onClick={() => setMobileMenuOpen(false)}
        >
          <nav
            style={{
              position: "fixed",
              top: "var(--topbar-height)",
              left: 0,
              right: 0,
              background: "var(--bg)",
              borderBottom: "1px solid var(--border)",
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              zIndex: 91,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {[
              { to: "/", label: "Home", end: true },
              { to: "/guides", label: "Guides" },
              { to: "/reference", label: "Reference" },
            ].map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setMobileMenuOpen(false)}
                style={({ isActive }) => ({
                  padding: "10px 14px",
                  borderRadius: "var(--radius-sm)",
                  fontWeight: 500,
                  fontSize: 15,
                  color: isActive ? "var(--blue-dark)" : "var(--ink-muted)",
                  background: isActive ? "var(--blue-light)" : "transparent",
                  textDecoration: "none",
                })}
              >
                {label}
              </NavLink>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 8, padding: "0 4px" }}>
              <a
                href={GITHUB_URL}
                className="topbar-link"
                target="_blank"
                rel="noreferrer noopener"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setMobileMenuOpen(false)}
              >
                <GitHubIcon /> GitHub
              </a>
              <a
                href={NPM_URL}
                className="topbar-link"
                target="_blank"
                rel="noreferrer noopener"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setMobileMenuOpen(false)}
              >
                <NpmIcon /> npm
              </a>
            </div>
          </nav>
        </div>
      )}

      {/* Page content */}
      <div className={isDocsPage ? "docs-layout" : "main-content"} style={{ flex: 1 }}>
        <Outlet />
      </div>

      {/* Footer */}
      <footer className="footer">
        <div>
          <strong>Open Dynamic Workflow</strong> — MIT License
        </div>
        <div className="footer-links">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
            GitHub
          </a>
          <a href={NPM_URL} target="_blank" rel="noreferrer noopener">
            npm
          </a>
          <a
            href="https://github.com/travisliu/open-dynamic-workflow/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer noopener"
          >
            License
          </a>
          <a
            href="https://github.com/travisliu/open-dynamic-workflow/blob/main/CHANGELOG.md"
            target="_blank"
            rel="noreferrer noopener"
          >
            Changelog
          </a>
        </div>
      </footer>
    </div>
  );
}
