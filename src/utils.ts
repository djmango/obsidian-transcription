/* Utility functions for Obsidian Transcript */
import which from "which";
import { App, FileSystemAdapter } from "obsidian";
import { existsSync } from "fs";
import { platform } from "os";

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

export async function addAdditionalPaths() {
    // Add additional paths to the PATH environment variable
    switch (platform()) {
		case "win32":
			process.env.PATH = `${process.env.PATH}${SettingsManager.currentSettings.additionalSearchPath}${delimiter}`;
			break;
		case "darwin":
		case "linux":
			process.env.PATH = `${process.env.PATH}${delimiter}${SettingsManager.currentSettings.additionalSearchPath}`;
			break;
		default:
			console.log(`Additional paths not implemented for platform ${platform()}. Doing nothing.`);
		}
		console.log(`Adding additional paths. $PATH is now ${process.env.PATH}`);
}

// TODO introduce checks for mobile
export async function applyHomebrewWorkaround() {
    if (existsSync("/opt/homebrew/bin")) {
        process.env.PATH = `${process.env.PATH}:/opt/homebrew/bin`;
        console.log(`Applied homebrew workaround: $PATH is now ${process.env.PATH}`);
    }
}
