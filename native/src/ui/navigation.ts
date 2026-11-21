export function navigate(path: string) {
  window.location.hash = path.startsWith("/") ? path : "/";
  window.dispatchEvent(new Event("native-navigation"));
}
const router = { push: navigate, replace: navigate, refresh: () => window.dispatchEvent(new Event("native-navigation")), back: () => history.back() };
export function useRouter() { return router; }
