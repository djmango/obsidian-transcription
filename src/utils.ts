/* Utility functions for Obsidian Transcript */
import { App, FileSystemAdapter, getBlobArrayBuffer } from "obsidian";

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

type PayloadAndBoundary = [ArrayBuffer, string];


export type PayloadData = { [key: string]: string | Blob | ArrayBuffer }

export async function payloadGenerator(payload_data: PayloadData): Promise<PayloadAndBoundary> {
    // This function is a workaround to current Obsidian API limitations: requestURL only supports string data or an unnamed blob, not key-value formdata
    // Essentially what we're doing here is constructing a multipart/form-data payload manually as a string and then passing it to requestURL

    const boundary_string = `Boundary${randomString(16)}`;
    const boundary = `------${boundary_string}`;
    const chunks: Uint8Array | ArrayBuffer[] = [];
    // const chunks: any[] = [];
    // NOTE Could this cause corrupt files via synchronous operations?
    for (const [key, value] of Object.entries(payload_data)) {
        // Start of a new part
        chunks.push(new TextEncoder().encode(`${boundary}\r\n`));

        // If the value is a string, then it's a key-value pair
        if (typeof value === 'string') {
            chunks.push(new TextEncoder().encode(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
            chunks.push(new TextEncoder().encode(`${value}\r\n`));
        }
        else if (value instanceof Blob) {
            chunks.push(new TextEncoder().encode(`Content-Disposition: form-data; name="${key}"; filename="blob"\r\nContent-Type: "application/octet-stream"\r\n\r\n`));
            chunks.push(await getBlobArrayBuffer(value));
            chunks.push(new TextEncoder().encode('\r\n'));
        }
        else {
            chunks.push(new Uint8Array(await new Response(value).arrayBuffer()));
            chunks.push(new TextEncoder().encode('\r\n'));
        }

    }
    await Promise.all(chunks);
    chunks.push(new TextEncoder().encode(`${boundary}--\r\n`));
    return [await new Blob(chunks).arrayBuffer(), boundary_string];
}
