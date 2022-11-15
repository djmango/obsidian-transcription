/* Utility functions for Obsidian Transcript */
import which from "which";
import { App, FileSystemAdapter } from "obsidian";

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

export const randomString = (length: number) => Array(length + 1).join((Math.random().toString(36) + '00000000000000000').slice(2, 18)).slice(0, length)
export const getAllLinesFromFile = (cache: string) => cache.split(/\r?\n/)
export const combineFileLines = (lines: string[]) => lines.join("\n")

/* Utility functions from Obsidian Shellcommands https://github.com/Taitava/obsidian-shellcommands/ */

export function getVaultAbsolutePath(app: App) {
    // Original code was copied 2021-08-22 from https://github.com/phibr0/obsidian-open-with/blob/84f0e25ba8e8355ff83b22f4050adde4cc6763ea/main.ts#L66-L67
    // But the code has been rewritten 2021-08-27 as per https://github.com/obsidianmd/obsidian-releases/pull/433#issuecomment-906087095
    const adapter = app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
        return adapter.getBasePath();
    }
    return null;
}


/**
 * For some reason there is no Platform.isWindows .
 */
export function isWindows() {
    return process.platform === "win32";
}


/**
 * Check if the given executable exists on the PATH
 * @param name the name of the executable to check
 * @returns true if it exists, false otherwise
 */
export async function doesProgramExist(name: string): Promise<boolean> {
    try {
        await which(name);
        return true;
    } catch (error) {
        return false;
    }
}

export function clampFileName(maxLength: number, fileName: string): string {
    if (fileName.length <= maxLength) return fileName;
    return `${fileName.slice(undefined, maxLength - 3)}...`;
}
