/**
 * Enterprise Queue Worker (Phase 2)
 * Offloads heavy tasks (like vector embedding or cleanup) from the main thread.
 * Designed to be replaced with BullMQ in a full Redis cluster.
 */
class QueueWorker {
  private queue: Array<{ id: string; name: string; task: () => Promise<void>; retries: number }> = [];
  private isProcessing = false;

  async enqueue(name: string, task: () => Promise<void>, maxRetries = 3) {
    this.queue.push({ id: Math.random().toString(36).substring(7), name, task, retries: maxRetries });
    console.log(`[QueueWorker] Task enqueued: ${name}`);
    if (!this.isProcessing) {
      this.processBackground();
    }
  }

  private async processBackground() {
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) continue;

      try {
        await job.task();
        console.log(`[QueueWorker] Task complete: ${job.name}`);
      } catch (e) {
        console.error(`[QueueWorker] Task failed: ${job.name}`, e);
        if (job.retries > 0) {
          job.retries--;
          this.queue.push(job); // push back for retry
        }
      }
    }
    this.isProcessing = false;
  }
}

export const BackgroundQueue = new QueueWorker();
