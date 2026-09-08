import { Component, type ReactNode } from "react";

/** Keeps a WebGL/lazy-chunk crash from white-screening the whole app. */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { err: Error | null }
> {
  state = { err: null as Error | null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error) {
    console.error("[codecity] view crashed:", err);
  }

  render() {
    if (this.state.err) {
      return (
        <div className="grid h-full w-full place-items-center bg-bg0 p-6 text-center font-mono text-sm text-white/60">
          <div>
            <p className="mb-3">💥 The city hit an unrecoverable error.</p>
            <button
              onClick={() => {
                this.setState({ err: null });
                location.hash = "";
              }}
              className="cursor-pointer rounded-xl border-[1.5px] border-black-ink bg-paper/95 px-3 py-2 font-bold text-black-ink transition-colors hover:text-signal"
            >
              ← back to site
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
