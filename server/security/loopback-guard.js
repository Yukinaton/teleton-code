function normalizeAddress(address = "") {
    return String(address || "").trim().toLowerCase();
}

export function isLoopbackAddress(address = "") {
    const normalized = normalizeAddress(address);
    return (
        normalized === "::1" ||
        normalized === "127.0.0.1" ||
        normalized === "::ffff:127.0.0.1" ||
        normalized.startsWith("127.")
    );
}

export function enforceLoopbackOnly(request, response, config, json) {
    if (
        config.security?.loopbackOnly === true &&
        !isLoopbackAddress(request.socket?.remoteAddress)
    ) {
        json(response, 403, {
            success: false,
            error: "Teleton Code is configured for loopback-only access."
        });
        return false;
    }

    return true;
}
