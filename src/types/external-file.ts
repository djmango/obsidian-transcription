import { TFile, Vault } from "obsidian";

/**
 * Type for different file source types
 */
export type FileSourceType = 'vault' | 'external' | 'url';

/**
 * Interface for transcribable file sources
 */
export interface TranscribableFileSource {
    type: FileSourceType;
    name: string;
    extension: string;
    displayName: string;
    getData: () => Promise<ArrayBuffer>;
}

/**
 * Implementation for vault files (existing functionality)
 */
export class VaultFileSource implements TranscribableFileSource {
    type: FileSourceType = 'vault';
    name: string;
    extension: string;
    displayName: string;
    private file: TFile;
    private vault: Vault;

    constructor(file: TFile, vault: Vault) {
        this.file = file;
        this.vault = vault;
        this.name = file.name;
        this.extension = file.extension;
        this.displayName = file.name;
    }

    async getData(): Promise<ArrayBuffer> {
        return await this.vault.readBinary(this.file);
    }

    getTFile(): TFile {
        return this.file;
    }
}

/**
 * Implementation for external files (selected via file picker)
 */
export class ExternalFileSource implements TranscribableFileSource {
    type: FileSourceType = 'external';
    name: string;
    extension: string;
    displayName: string;
    private file: File;

    constructor(file: File) {
        this.file = file;
        this.name = file.name;
        this.extension = this.name.split('.').pop() || '';
        this.displayName = `📄 ${this.name}`;
    }

    async getData(): Promise<ArrayBuffer> {
        try {
            return await this.file.arrayBuffer();
        } catch (error) {
            throw new Error(`Failed to read external file: ${error.message}`);
        }
    }

    getFile(): File {
        return this.file;
    }
}

/**
 * Implementation for online files (URLs)
 */
export class UrlFileSource implements TranscribableFileSource {
    type: FileSourceType = 'url';
    name: string;
    extension: string;
    displayName: string;
    private url: string;

    constructor(url: string) {
        this.url = url;
        // Extract filename from URL
        const urlParts = url.split('/');
        this.name = urlParts[urlParts.length - 1] || 'online-file';
        this.extension = this.name.split('.').pop() || '';
        this.displayName = `🌐 ${this.name}`;
    }

    async getData(): Promise<ArrayBuffer> {
        try {
            const response = await fetch(this.url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.arrayBuffer();
        } catch (error) {
            throw new Error(`Failed to download file from URL: ${error.message}`);
        }
    }

    getUrl(): string {
        return this.url;
    }
}