/* Utility functions for Obsidian Transcript */

/**
 * Creates a new Uint8Array by concating provided ArrayBuffers
 * https://gist.github.com/72lions/4528834
 *
 * @private
 * @param {ArrayBuffer} bufs The first buffer.
 * @return {ArrayBuffer} The new ArrayBuffer created out of the two.
 */
export function appendBuffer(buffer1: ArrayBuffer, buffer2: ArrayBuffer) {
    const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
}

export const getAllLinesFromFile = (cache: string) => cache.split(/\r?\n/)
export const combineFileLines = (lines: string[]) => lines.join("\n")