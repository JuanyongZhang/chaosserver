/** A FIFO queue that keeps at most `maxSize` items, dropping the oldest first. */
export default class FixedSizeQueue<T> {
    readonly queue: T[];
    readonly maxSize: number;

    constructor(maxSize: number) {
        this.queue = [];
        this.maxSize = maxSize;
    }

    /** Number of items currently held. */
    get size(): number {
        return this.queue.length;
    }

    enqueue(item: T): void {
        if (this.queue.length >= this.maxSize) {
            this.queue.shift(); // remove the first item if the queue is at max capacity
        }
        this.queue.push(item);
    }

    dequeue(): T | undefined {
        return this.queue.shift();
    }

    getItems(): T[] {
        return this.queue;
    }

    clear(): void {
        this.queue.length = 0;
    }
}
