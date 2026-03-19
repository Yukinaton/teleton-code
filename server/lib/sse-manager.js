const taskSubscribers = new Map();

export function writeSse(response, event, data) {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function publishTaskEvent(taskId, event, payload) {
    const subscribers = taskSubscribers.get(taskId);
    if (!subscribers || subscribers.size === 0) {
        return;
    }

    for (const response of subscribers) {
        writeSse(response, event, payload);
    }
}

export function subscribeTaskStream(taskId, response, getPayload) {
    response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive"
    });

    if (!taskSubscribers.has(taskId)) {
        taskSubscribers.set(taskId, new Set());
    }

    const subscribers = taskSubscribers.get(taskId);
    subscribers.add(response);
    
    const payload = getPayload(taskId);
    writeSse(response, "task.snapshot", payload);

    if (payload.task?.status === "completed") {
        writeSse(response, "task.completed", payload);
    } else if (payload.task?.status === "failed") {
        writeSse(response, "task.failed", payload);
    }

    response.on("close", () => {
        subscribers.delete(response);
        if (subscribers.size === 0) {
            taskSubscribers.delete(taskId);
        }
    });
}
