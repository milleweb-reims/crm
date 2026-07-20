"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Kanban,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut, useSession } from "next-auth/react";
import { useState } from "react";
import { useSidebarCollapsed, setSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Prospects", href: "/prospects", icon: Users },
  { name: "Pipeline", href: "/pipeline", icon: Kanban },
];

const bottomNav = [
  { name: "Paramètres", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = useSidebarCollapsed();

  function toggleCollapsed() {
    setSidebarCollapsed(!collapsed);
  }

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const roleLabels: Record<string, string> = {
    admin: "Admin",
    closer: "Closer",
    dev: "Dev",
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className={cn(
        "flex h-16 items-center gap-2 border-b border-border",
        collapsed ? "justify-center px-2" : "px-6"
      )}>
        <Image
          src="/logo_MILLEWEB_bleu-noir.svg"
          alt="Milleweb"
          width={collapsed ? 32 : 140}
          height={32}
          className="flex-shrink-0"
          priority
        />
      </div>

      {/* Main nav */}
      <nav className={cn("flex-1 py-4 space-y-1", collapsed ? "px-2" : "px-3")}>
        {navigation.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            title={collapsed ? item.name : undefined}
            className={cn(
              "flex items-center rounded-lg text-sm font-medium transition-colors",
              collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
              isActive(item.href)
                ? "bg-primary-light text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {!collapsed && item.name}
          </Link>
        ))}
      </nav>

      {/* Bottom nav */}
      <div className={cn("border-t border-border py-4 space-y-1", collapsed ? "px-2" : "px-3")}>
        {/* Collapse toggle - desktop only */}
        <button
          onClick={toggleCollapsed}
          className={cn(
            "hidden lg:flex items-center rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer w-full",
            collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
          )}
          title={collapsed ? "Ouvrir la sidebar" : "Réduire la sidebar"}
        >
          {collapsed ? (
            <ChevronsRight className="h-5 w-5 flex-shrink-0" />
          ) : (
            <>
              <ChevronsLeft className="h-5 w-5 flex-shrink-0" />
              Réduire
            </>
          )}
        </button>

        {bottomNav.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            title={collapsed ? item.name : undefined}
            className={cn(
              "flex items-center rounded-lg text-sm font-medium transition-colors",
              collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
              isActive(item.href)
                ? "bg-primary-light text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {!collapsed && item.name}
          </Link>
        ))}

        {/* User profile */}
        {session?.user && (
          <div className={cn(
            "flex items-center rounded-lg mt-2",
            collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
          )}>
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
              {session.user.name?.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {session.user.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {roleLabels[session.user.role] ?? session.user.role}
                  </p>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                  title="Déconnexion"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 lg:hidden rounded-lg bg-background border border-border p-2 shadow-sm cursor-pointer"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar - always expanded */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[280px] bg-background border-r border-border flex flex-col transition-transform lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 text-muted-foreground cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 bg-background border-r border-border transition-all duration-200",
          collapsed ? "lg:w-[68px]" : "lg:w-[280px]"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
