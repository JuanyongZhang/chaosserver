import FixedSizeQueue from './fixedSizeArray';

describe('FixedSizeQueue', () => {
    it('starts empty', () => {
        const queue = new FixedSizeQueue<number>(3);

        expect(queue.size).toBe(0);
        expect(queue.maxSize).toBe(3);
        expect(queue.getItems()).toEqual([]);
    });

    it('enqueues items preserving FIFO order', () => {
        const queue = new FixedSizeQueue<number>(3);

        queue.enqueue(1);
        queue.enqueue(2);
        queue.enqueue(3);

        expect(queue.size).toBe(3);
        expect(queue.getItems()).toEqual([1, 2, 3]);
    });

    it('drops the oldest item when the queue is at max capacity', () => {
        const queue = new FixedSizeQueue<number>(2);

        queue.enqueue(1);
        queue.enqueue(2);
        queue.enqueue(3);

        expect(queue.getItems()).toEqual([2, 3]);
        expect(queue.size).toBe(2);
    });

    it('never grows beyond maxSize', () => {
        const queue = new FixedSizeQueue<number>(2);

        for (let i = 0; i < 100; i++) {
            queue.enqueue(i);
        }

        expect(queue.size).toBe(2);
        expect(queue.getItems()).toEqual([98, 99]);
    });

    it('dequeues from the front and removes the item', () => {
        const queue = new FixedSizeQueue<string>(3);

        queue.enqueue('a');
        queue.enqueue('b');

        expect(queue.dequeue()).toBe('a');
        expect(queue.getItems()).toEqual(['b']);
        expect(queue.size).toBe(1);
    });

    it('returns undefined when dequeuing an empty queue', () => {
        const queue = new FixedSizeQueue<string>(1);

        expect(queue.dequeue()).toBeUndefined();
    });

    it('exposes the live underlying array through getItems', () => {
        const queue = new FixedSizeQueue<number>(2);
        const items = queue.getItems();

        queue.enqueue(1);

        expect(items).toBe(queue.queue);
        expect(items).toEqual([1]);
    });

    it('clears all items, keeping the same instance', () => {
        const queue = new FixedSizeQueue<number>(2);
        const items = queue.getItems();

        queue.enqueue(1);
        queue.enqueue(2);
        queue.clear();

        expect(queue.size).toBe(0);
        expect(queue.getItems()).toEqual([]);
        expect(queue.getItems()).toBe(items);
    });

    it('accepts new items after being cleared', () => {
        const queue = new FixedSizeQueue<number>(2);

        queue.enqueue(1);
        queue.clear();
        queue.enqueue(2);

        expect(queue.getItems()).toEqual([2]);
    });
});
