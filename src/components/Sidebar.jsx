"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout, getUsername } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/dashboard", icon: "📊", label: "Dashboard" },
  { href: "/create", icon: "✏️", label: "Create Entry" },
  { href: "/knowledge", icon: "📚", label: "Knowledge Base" },
  { href: "/leaderboard", icon: "🏆", label: "Leaderboard" },
  { href: "/browse", icon: "🔍", label: "Browse & Export" },
  { href: "/help", icon: "🧭", label: "Help & Training" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const username = getUsername();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Dataset Generator</div>
      <div className="sidebar-user">Signed in as {username}</div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${pathname === item.href ? "active" : ""}`}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button className="nav-link" onClick={logout} style={{ color: "#DC2626" }}>
          <span>🚪</span> Sign Out
        </button>
      </div>
    </aside>
  );
}
