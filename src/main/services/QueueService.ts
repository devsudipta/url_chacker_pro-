import { abortableDelay } from "./HttpProbeService";
import type { Settings } from "../../../shared/types";
export class QueueService {
  paused = false;
  private active = new Map<string, number>();
  private last = new Map<string, number>();
  constructor(
    private settings: Settings,
    private signal: AbortSignal,
  ) {}
  async ready(): Promise<void> {
    while (this.paused) await abortableDelay(50, this.signal);
    if (this.signal.aborted) throw this.signal.reason;
  }
  async acquire(url: string): Promise<() => void> {
    const host = new URL(url).host;
    while (true) {
      await this.ready();
      const count = this.active.get(host) ?? 0,
        now = Date.now();
      if (
        count < this.settings.perHostConcurrency &&
        now - (this.last.get(host) ?? 0) >= this.settings.hostDelay
      ) {
        this.active.set(host, count + 1);
        this.last.set(host, now);
        return () =>
          this.active.set(host, Math.max(0, (this.active.get(host) ?? 1) - 1));
      }
      await abortableDelay(20, this.signal);
    }
  }
}
