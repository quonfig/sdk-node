import { realpathSync, watch, type FSWatcher } from "fs";

export interface DatadirWatcherOptions {
  /** The configured datadir path; the watcher resolves symlinks internally. */
  datadir: string;
  /** Debounce window in ms — coalesces bursts (atomic-rename saves, git pull). */
  debounceMs: number;
  /** Fired once per debounced burst, on the SDK's reload path. */
  onChange: () => void;
  /** Fired on watcher / registration errors. The SDK logs and continues. */
  onError: (err: unknown) => void;
}

/**
 * Watches a datadir for changes and invokes `onChange` once per debounced
 * burst. Uses Node's built-in `fs.watch({recursive: true})` (stable on Linux
 * since Node 20; supported on macOS/Windows). Registration failures (read-only
 * fs, immutable container) are caught and surfaced via `onError`; in that case
 * `start()` returns `false` and no watcher is held.
 *
 * The caller owns parse-then-swap: this class only fires the trigger.
 */
export class DatadirWatcher {
  private watcher?: FSWatcher;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(private readonly opts: DatadirWatcherOptions) {}

  start(): boolean {
    try {
      // Resolve symlinks at start time so atomic flips of the *link* are not
      // detected (documented behavior). Watching the real path is the common
      // ask — "edit the file the link points at, see updates."
      const resolved = realpathSync(this.opts.datadir);
      const watcher = watch(resolved, { recursive: true }, () => {
        this.schedule();
      });
      watcher.on("error", (err) => {
        this.opts.onError(err);
      });
      this.watcher = watcher;
      return true;
    } catch (err) {
      this.opts.onError(err);
      return false;
    }
  }

  private schedule(): void {
    if (this.closed) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      if (this.closed) return;
      this.opts.onChange();
    }, this.opts.debounceMs);
  }

  close(): void {
    this.closed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // best-effort — caller already in shutdown
      }
      this.watcher = undefined;
    }
  }
}
