export function withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        Promise.resolve(promise)
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

export function withActivityTimeout(run, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer = null;

        const clearTimer = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        };

        const touch = () => {
            clearTimer();
            timer = setTimeout(() => {
                if (!settled) {
                    reject(new Error(`${label} timed out after ${timeoutMs}ms`));
                }
            }, timeoutMs);
        };

        touch();

        Promise.resolve(run({ touch }))
            .then((value) => {
                settled = true;
                clearTimer();
                resolve(value);
            })
            .catch((error) => {
                settled = true;
                clearTimer();
                reject(error);
            });
    });
}

export function createDummyBridge() {
    const unsupported = async () => {
        throw new Error("Telegram bridge operations not available in Teleton Code");
    };

    return {
        sendMessage: unsupported,
        setTyping: async () => {},
        sendReaction: unsupported,
        getMessages: unsupported,
        getClient: unsupported
    };
}

export function toolCallFromExecutedEvent(event) {
    if (event?.type !== "tool_finished" || !event?.name) {
        return null;
    }

    if (event?.result?.requiresPermission === true || event?.result?.success === false) {
        return null;
    }

    return {
        name: event.name,
        input: event.params || {},
        result: event.result || {}
    };
}

export function failedToolEventFromExecutedEvent(event) {
    if (event?.type !== "tool_finished" || !event?.name) {
        return null;
    }

    if (event?.result?.requiresPermission === true || event?.result?.success !== false) {
        return null;
    }

    return {
        name: event.name,
        params: event.params || {},
        result: event.result || {}
    };
}
