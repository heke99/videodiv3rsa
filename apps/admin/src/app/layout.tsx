import type { Metadata } from "next";
import "@videoai/ui/globals.css";

const appName = process.env["NEXT_PUBLIC_APP_NAME"] ?? "Video AI";

export const metadata: Metadata = { title: `${appName} operations` };

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/gpu", label: "GPU" },
  { href: "/models", label: "Models" },
  { href: "/skills", label: "Skills" },
  { href: "/quality", label: "Quality" },
  { href: "/costs", label: "Costs" },
  { href: "/jobs", label: "Jobs" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
          <div className="page" style={{ padding: "0.85rem 1.25rem" }}>
            <div
              className="row"
              style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}
            >
              <strong>{appName} operations</strong>
              <nav className="row" style={{ gap: "0.9rem", flexWrap: "wrap" }}>
                {TABS.map((tab) => (
                  <a key={tab.href} href={tab.href} className="muted" style={{ textDecoration: "none" }}>
                    {tab.label}
                  </a>
                ))}
              </nav>
            </div>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
