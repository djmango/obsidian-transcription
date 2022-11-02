
// From https://github.com/denolehov/obsidian-git/
// All because we can't use (for await)...

// Convert a value to an Async Iterator
// This will be easier with async generator functions.
function fromValue(value: any) {
    let queue = [value];
    return {
        next() {
            return Promise.resolve({ done: queue.length === 0, value: queue.pop() });
        },
        return() {
            queue = [];
            return {};
        },
        [Symbol.asyncIterator]() {
            return this;
        },
    };
}

function getIterator(iterable: any) {
    if (iterable[Symbol.asyncIterator]) {
        return iterable[Symbol.asyncIterator]();
    }
    if (iterable[Symbol.iterator]) {
        return iterable[Symbol.iterator]();
    }
    if (iterable.next) {
        return iterable;
    }
    return fromValue(iterable);
}

async function forAwait(iterable: any, cb: any) {
    const iter = getIterator(iterable);
    //eslint-disable-next-line no-constant-condition
    while (true) {
        const { value, done } = await iter.next();
        if (value) await cb(value);
        if (done) break;
    }
    if (iter.return) iter.return();
}

async function collect(iterable: any): Promise<Uint8Array> {
    let size = 0;
    const buffers: Uint8Array[] = [];
    // This will be easier once `for await ... of` loops are available.
    await forAwait(iterable, (value: any) => {
        buffers.push(value);
        size += value.byteLength;
    });
    const result = new Uint8Array(size);
    let nextIndex = 0;
    for (const buffer of buffers) {
        console.log(size)
        console.log(nextIndex);
        console.log(result)
        result.set(buffer, nextIndex);
        nextIndex += buffer.byteLength;
    }
    return result;
}

export { collect };