"use client";

import { useSyncExternalStore } from "react";

const COLLAPSED_KEY = "sidebar-collapsed";
const TOGGLE_EVENT = "sidebar-toggle";

// In-memory source of truth so the toggle keeps working even when
// localStorage is blocked (strict private browsing); storage is only
// the persistence layer. null = not yet read from storage.
let collapsedValue: boolean | null = null;

function readStorage(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(TOGGLE_EVENT, onStoreChange);
  return () => window.removeEventListener(TOGGLE_EVENT, onStoreChange);
}

function getSnapshot() {
  if (collapsedValue === null) collapsedValue = readStorage();
  return collapsedValue;
}

// Server render (and hydration) always start expanded.
function getServerSnapshot() {
  return false;
}

/**
 * Sidebar collapsed state, shared between Sidebar and DashboardLayout.
 * Backed by localStorage so the preference survives reloads.
 */
export function useSidebarCollapsed() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setSidebarCollapsed(next: boolean) {
  collapsedValue = next;
  try {
    localStorage.setItem(COLLAPSED_KEY, String(next));
  } catch {
    // Preference won't survive a reload, but the toggle still works
  }
  window.dispatchEvent(new Event(TOGGLE_EVENT));
}
