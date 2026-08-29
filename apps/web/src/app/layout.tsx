import type { Metadata } from "next";
import "@videoai/ui/globals.css";

/**
 * The shell. The product name comes from configuration so a rebrand or a
 * domain move needs no code change (spec section 58).
 */
const appName = process.env["NEXT_PUBLIC_APP_NAME"] ?? "Video AI";

export const metadata: Metadata = {
  title: appName,
  description: "Create video from a description.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header
          style={{
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <div className="page row" style={{ padding: "0.85rem 1.25rem", justifyContent: "space-between" }}>
            <a href="/" style={{ fontWeight: 600, textDecoration: "none" }}>
              {appName}
            </a>
            <nav className="row" style={{ gap: "1rem" }}>
              <a href="/" style={{ textDecoration: "none" }} className="muted">
                Projects
              </a>
              <a href="/library" style={{ textDecoration: "none" }} className="muted">
                Library
              </a>
              <a href="/create">
                <button className="primary">New video</button>
              </a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
