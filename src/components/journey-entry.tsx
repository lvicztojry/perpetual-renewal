"use client";

import { Moon } from "lucide-react";

export function JourneyEntry({ className = "text-button" }: { className?: string }) {
  return <button className={className} type="button" onClick={() => window.dispatchEvent(new Event("renewal:journey-open"))}>
    <Moon size={16} aria-hidden="true" /> 找余念安
  </button>;
}
