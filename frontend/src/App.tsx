import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import Landing from "./pages/Landing";
const CityScene = lazy(() => import("./three/CityScene").then((m) => ({ default: m.CityScene })));
// HUD pulls drei/three — lazy so the landing bundle stays 3D-free
const HUD = lazy(() =>
  import("./ui/HUD").then((m) => ({ default: m.HUD })),
);
import { CommandPalette, type PaletteItem } from "./components/ui/CommandPalette";
import { AuthModal } from "./components/AuthModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { completeOauthFromUrl, ensureSession, oauthCallbackApi, useAuth } from "./lib/auth";
import { togglePalette, useUi } from "./store/useUi";
import { CursorGlow, Noise } from "./components/ui/effects";

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function App() {
  const [view, setView] = useState<"landing" | "app">(() =>
    location.hash === "#app" ? "app" : "landing",
  );
  // overlay gates live in a tiny store so the city's global shortcut handler
  // can stand down while the palette / auth modal is open
  const paletteOpen = useUi((s) => s.paletteOpen);
  const authOpen = useUi((s) => s.authOpen);
  const closePalette = useCallback(() => useUi.setState({ paletteOpen: false }), []);
  const openAuth = useCallback(() => useUi.setState({ authOpen: true }), []);

  // hash-based routing (no router dep needed)
  useEffect(() => {
    const onHash = () => setView(location.hash === "#app" ? "app" : "landing");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const launch = useCallback(() => {
    // auth gate — a refresh token counts as signed in: ensureSession() will
    // mint the access token on boot, so we never bounce a real user to login
    if (!useAuth.getState().token && !useAuth.getState().refreshToken) {
      sessionStorage.setItem("cc-auth-intent", "app");
      openAuth();
      return;
    }
    location.hash = "#app";
    setView("app");
  }, [openAuth]);

  // ── BOOT SESSION ────────────────────────────────────────────────────────
  // Restore a live access token BEFORE the first API call (the repo auto-load
  // fires on a 0 ms timeout, so this gates it). Without this, a cold tab with
  // only a refresh token sends its first request header-less and the user sees
  // the backend's raw "Missing bearer token" — the worst possible first paint.
  useEffect(() => {
    void ensureSession();
  }, []);

  // warm the 3D chunk on intent (hover/focus) and during idle — city opens instantly
  const preloadCity = useCallback(() => {
    void import("./three/CityScene");
  }, []);
  useEffect(() => {
    const idle = requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
    const id = idle(() => preloadCity());
    return () => cancelIdleCallback?.(id);
  }, [preloadCity]);

  // finish OAuth redirects: server bounces back with #oauth=<token> or API callback
  useEffect(() => {
    void completeOauthFromUrl().then((session) => {
      if (!session) {
        const err = location.hash.match(/#auth-error=([^&]+)/);
        if (err) history.replaceState(null, "", location.pathname + location.search);
        return;
      }
      const intent = sessionStorage.getItem("cc-auth-intent");
      sessionStorage.removeItem("cc-auth-intent");
      if (intent === "app" || location.hash.includes("#app")) {
        location.hash = "#app";
        setView("app");
      }
    });
    // Also try the API callback approach for SPA flows
    void oauthCallbackApi().then((apiResult) => {
      if (apiResult.success && apiResult.redirect) {
        location.hash = apiResult.redirect.replace("/#", "#");
        setView("app");
      }
    });
  }, []);
  const home = useCallback(() => {
    location.hash = "";
    setView("landing");
  }, []);

  // ⌘K / Ctrl+K toggles the command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems = useMemo<PaletteItem[]>(
    () =>
      view === "landing"
        ? [
            { id: "launch", label: "Launch City", hint: "live demo", run: launch },
            { id: "go-raster", label: "Go to 01 System", run: () => scrollToId("raster") },
            { id: "go-atlas", label: "Go to 02 Atlas", run: () => scrollToId("atlas") },
            { id: "go-zeit", label: "Go to 03 Live Data", run: () => scrollToId("zeit") },
            { id: "go-faq", label: "Go to FAQ", run: () => scrollToId("faq") },
            { id: "go-terminals", label: "Go to Launch panel", run: () => scrollToId("terminals") },
            { id: "top", label: "Back to top", run: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
          ]
        : [
            { id: "home", label: "Back to landing page", run: home },
          ],
    [view, launch, home],
  );

  const signOut = useAuth((s) => s.signOut);
  const user = useAuth((s) => s.user);
  const appPaletteExtras = useMemo<PaletteItem[]>(() => {
    if (view !== "app") return [];
    const extras: PaletteItem[] = [
      { id: "menu", label: "Open menu", hint: "build · search · view · panels", run: () => useUi.setState({ menuOpen: true }) },
      { id: "reqflow", label: "Request flow", hint: "trace requests through the city", run: () => useUi.setState((s) => ({ hiddenPanels: { ...s.hiddenPanels, apis: false } })) },
    ];
    if (user) {
      extras.push({ id: "whoami", label: `Signed in as ${user.name}`, hint: user.email, run: () => {} });
      extras.push({ id: "signout", label: "Sign out", run: signOut });
    } else {
      extras.push({ id: "signin", label: "Sign in / Create account", run: openAuth });
    }
    return extras;
  }, [view, user, signOut, openAuth]);

  return (
    <>
      {view === "app" ? (
        <div className="relative h-screen w-screen overflow-hidden bg-bg0">
          <Suspense fallback={<div className="grid h-full place-items-center font-mono text-sm text-white/50">🏗 building the city…</div>}>
            <ErrorBoundary>
              <CityScene />
            </ErrorBoundary>
          </Suspense>
          <ErrorBoundary>
            <HUD />
          </ErrorBoundary>
        </div>
      ) : (
        <Landing onLaunch={launch} onLaunchIntent={preloadCity} />
      )}
      <Noise />
      {view === "app" && <CursorGlow />}
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        items={[...paletteItems, ...appPaletteExtras]}
      />
      <AuthModal
        open={authOpen}
        onClose={() => useUi.setState({ authOpen: false })}
        onSuccess={() => {
          useUi.setState({ authOpen: false });
          location.hash = "#app";
          setView("app");
        }}
      />
    </>
  );
}
