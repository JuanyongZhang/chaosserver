/** Port used when the `PORT` environment variable is not set. */
export const DEFAULT_PORT = 13526;

/** Name of the environment variable read for the HTTP port. */
export const PORT_ENV_VAR = 'PORT';

const MIN_PORT = 0;
const MAX_PORT = 65535;

/**
 * Resolves the HTTP port from a raw environment value (usually `process.env.PORT`).
 *
 * - unset or blank -> {@link DEFAULT_PORT} (or the supplied `fallback`)
 * - invalid value  -> throws, so misconfiguration fails fast at startup
 */
export function resolvePort(raw?: string, fallback: number = DEFAULT_PORT): number {
    if (raw === undefined || raw.trim() === '') {
        return fallback;
    }

    const port = Number(raw);

    if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
        throw new Error(
            `Invalid ${PORT_ENV_VAR} value "${raw}": expected an integer between ${MIN_PORT} and ${MAX_PORT}.`,
        );
    }

    return port;
}
