import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("native-navigation", listener);
  return () => { window.removeEventListener("hashchange", listener); window.removeEventListener("native-navigation", listener); };
}
export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.hash.slice(1).split(/[?#]/, 1)[0] || "/", () => "/");
}
export function navigate(path: string) {
  window.location.hash = path.startsWith("/") ? path : "/";
  window.dispatchEvent(new Event("native-navigation"));
}
const router = { push: navigate, replace: navigate, refresh: () => window.dispatchEvent(new Event("native-navigation")), back: () => history.back() };
export function useRouter() { return router; }
