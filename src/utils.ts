/* Utility functions for Obsidian Transcript */
import { App, FileSystemAdapter, TFile, Vault, getBlobArrayBuffer } from "obsidian";

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

export async function fileToRequestPayload(file: TFile, vault: Vault): Promise<PayloadAndBoundary> {
    // This is a workaround to current Obsidian API limitations: requestURL only supports string data or an unnamed blob, not key-value formdata
    // Essentially what we're doing here is constructing a multipart/form-data payload manually as a string and then passing it to requestURL
    // I believe this to be equivalent to the following curl command: curl --location --request POST 'http://localhost:9000/asr?task=transcribe&language=en' --form 'audio_file=@"test-vault/02 Files/Recording.webm"'

    // Generate the form data payload Boundary string, it can be arbitrary, I'm just using a random string here
    // https://stackoverflow.com/questions/3508338/what-is-the-boundary-in-multipart-form-data
    // https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
    const randomBoundaryString = "Boundary" + randomString(16); // Prefix + 16 char random Boundary string

    // Construct the form data payload as a string
    const pre_string = `------${randomBoundaryString}\r\nContent-Disposition: form-data; name="audio_file"; filename="blob"\r\nContent-Type: "application/octet-stream"\r\n\r\n`;
    const post_string = `\r\n------${randomBoundaryString}--`

    // Convert the form data payload to a blob by concatenating the pre_string, the file data, and the post_string, and then return the blob as an array buffer
    const pre_string_encoded = new TextEncoder().encode(pre_string);
    const data = new Blob([await vault.readBinary(file)]);
    console.log(data)
    console.log(await getBlobArrayBuffer(data))
    const post_string_encoded = new TextEncoder().encode(post_string);
    const payload = await new Blob([pre_string_encoded, await getBlobArrayBuffer(data), post_string_encoded]).arrayBuffer()

    return [payload, randomBoundaryString]
}

export type PayloadData = { [key: string]: string | Blob | ArrayBuffer }

export async function payloadGenerator(payload_data: PayloadData): Promise<PayloadAndBoundary> {

    // this is a key value pair, keys are always strings, values can be strings or blobs

    // This is a workaround to current Obsidian API limitations: requestURL only supports string data or an unnamed blob, not key-value formdata
    // Note that this code assumes that value can be either a string or a Blob, and uses Response.arrayBuffer() to convert the Blob into an ArrayBuffer.
    const boundary_string = `Boundary${randomString(16)}`;
    const boundary = `------${boundary_string}`;
    // const chunks: Uint8Array | ArrayBuffer[] = [];
    const chunks: any[] = [];
    // await payload_data.forEach(async (value, key) => {
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
