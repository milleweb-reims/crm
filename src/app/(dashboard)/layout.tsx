"use client";

import { Sidebar } from "@/components/sidebar";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const collapsed = useSidebarCollapsed();

  return (
    <div className="min-h-screen">
      <Sidebar />
      <main
        className="transition-all duration-200 lg:pl-[var(--sidebar-width)]"
        style={{ "--sidebar-width": collapsed ? "68px" : "280px" } as React.CSSProperties}
      >
        <div className="p-4 pt-16 sm:p-6 sm:pt-16 lg:p-10 lg:pt-10">{children}</div>
      </main>
    </div>
  );
}
