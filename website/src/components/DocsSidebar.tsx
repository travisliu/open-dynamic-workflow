import { NavLink, useLocation } from "react-router-dom";

interface SidebarItem {
  label: string;
  to: string;
  id?: string;
}

interface SidebarSection {
  title: string;
  items: SidebarItem[];
}

interface DocsSidebarProps {
  sections: SidebarSection[];
}

export default function DocsSidebar({ sections }: DocsSidebarProps) {
  const location = useLocation();

  return (
    <aside className="docs-sidebar" aria-label="Documentation navigation">
      {sections.map((section) => (
        <div className="sidebar-section" key={section.title}>
          <div className="sidebar-section-title">{section.title}</div>
          <nav className="sidebar-nav">
            {section.items.map((item) => {
              const isActive =
                location.pathname === item.to ||
                (item.id && location.hash === `#${item.id}`);
              return (
                <NavLink
                  key={item.to + (item.id ?? "")}
                  to={item.id ? `${item.to}#${item.id}` : item.to}
                  className={isActive ? "active" : ""}
                  end
                >
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      ))}
    </aside>
  );
}
