"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);

    function handleToggle(e: Event) {
      setCollapsed((e as CustomEvent).detail);
    }

    window.addEventListener("sidebar-toggle", handleToggle);
    return () => window.removeEventListener("sidebar-toggle", handleToggle);
  }, []);

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
