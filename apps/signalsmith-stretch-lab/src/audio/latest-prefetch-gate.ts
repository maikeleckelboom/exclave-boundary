export class LatestPrefetchGate<TValue> {
  private activePromise: Promise<void> | null = null;
  private latestRequestId = 0;

  get busy(): boolean {
    return this.activePromise !== null;
  }

  request(load: () => Promise<TValue>, post: (value: TValue) => void): void {
    const requestId = this.latestRequestId + 1;
    this.latestRequestId = requestId;

    const promise = load()
      .then((value) => {
        if (requestId === this.latestRequestId) {
          post(value);
        }
      })
      .finally(() => {
        if (this.activePromise === promise) {
          this.activePromise = null;
        }
      });

    this.activePromise = promise;
  }
}
