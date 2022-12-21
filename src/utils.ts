/* Utility functions for Obsidian Transcript */
import { App, FileSystemAdapter } from "obsidian";

export const randomString = (length: number) => Array(length + 1).join((Math.random().toString(36) + '00000000000000000').slice(2, 18)).slice(0, length)
export const getAllLinesFromFile = (cache: string) => cache.split(/\r?\n/)
export const combineFileLines = (lines: string[]) => lines.join("\n")

export function getVaultAbsolutePath(app: App) {
    // Original code was copied 2021-08-22 from https://github.com/phibr0/obsidian-open-with/blob/84f0e25ba8e8355ff83b22f4050adde4cc6763ea/main.ts#L66-L67
    // But the code has been rewritten 2021-08-27 as per https://github.com/obsidianmd/obsidian-releases/pull/433#issuecomment-906087095
    const adapter = app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
        return adapter.getBasePath();
    }
    return null;
}
