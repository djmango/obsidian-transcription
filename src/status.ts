// Inspired by
// https://github.com/renehernandez/obsidian-readwise/blob/eee5676524962ebfa7eaf1084e018dafe3c2f394/src/status.ts

export class StatusBar {
    private messages: StatusBarMessage[] = [];
    private currentMessage: StatusBarMessage;
    private statusBarEl: HTMLElement;

    constructor(statusBarEl: HTMLElement) {
        this.statusBarEl = statusBarEl;
    }

    displayMessage(message: string, timeout: number, force = false) {
        // Don't show the same message twice
        if (this.messages[0] && this.messages[0].message === message) return;

        this.messages.push(new StatusBarMessage(`Transcribe: ${message.slice(0, 100)}`, timeout, force));
        this.display();
    }

    display() {
        // Only act if the current message has timed out or we are forcing a new message
        
        // Okay TODO redo this logic, technically this is stupid but its 3 and i need to board plane
        if (this.currentMessage && this.currentMessage.messageTimedOut()) {
            // If there are more messages, display the next one
            if (this.messages.length > 0) {
                // If any message in the queue is forced, clear the queue and display the last forced message
                if (this.messages.some((message) => message.force)) {
                    const lastForced = this.messages.filter((message) => message.force).pop();
                    if (lastForced) this.messages = [lastForced];
                }

                // Display the next message
                const currentMessage = this.messages.shift()
                if (currentMessage) this.currentMessage = currentMessage; // This is just to make TypeScript happy
                this.statusBarEl.setText(this.currentMessage.message);
            } else { // Otherwise, clear the status bar
                this.statusBarEl.setText("");
            }
        }
        else if (!this.currentMessage && this.messages.length > 0) {
            // If the current message hasn't timed out, but there are more messages, display the next one
            const currentMessage = this.messages.shift()
            if (currentMessage) this.currentMessage = currentMessage; // This is just to make TypeScript happy
            this.statusBarEl.setText(this.currentMessage.message);
        }
    }
}

class StatusBarMessage {
    message: string;
    timeout: number;
    force: boolean;

    messageAge = function () {
        return Date.now() - this.lastMessageTimestamp;
    }

    messageTimedOut = function () {
        return this.messageAge() >= this.timeout;
    }

    constructor(message: string, timeout: number, force = false) {
        this.message = message;
        this.timeout = timeout;
        this.force = force;
    }
}
