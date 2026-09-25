import express, { Express, NextFunction, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { unset } from 'lodash';
import FixedSizeQueue from './commons/fixedSizeArray';
import {
    ChaosServerConfiguration,
    ChaosServerHeader,
    ChaosServerOptions,
    ChaosServerSettings,
    ChaosServerStorage,
    RecordedRequest,
} from './types';

export const DEFAULT_REQUEST_HISTORY_SIZE = 50;
export const CHAOS_SERVER_HEADER_NAME = 'x-chaosserver';
export const SETTINGS_URL = '/_internal_/settings';
export const REQUESTS_URL = '/_internal_/requests';

/** Settings used when no override is supplied. */
export const DEFAULT_SETTINGS: ChaosServerSettings = {
    configuration: {
        latency: 200,
        connectionReset: 1,
        unavailable: 1,
    },
    response: {
        status: 200,
        body: { success: true },
    },
};

/** The action the chaos middleware takes for a request. */
export type ChaosOutcome = 'unavailable' | 'connectionReset' | 'proxy' | 'mock';

/** A `createApp` result: the Express app plus its in-memory state. */
export interface ChaosServer {
    app: Express;
    storage: ChaosServerStorage;
}

/**
 * Decides which chaos action to apply. The order (unavailable, then connection
 * reset, then proxy/mock) matches the historical behaviour of the server.
 *
 * `random` is injectable so the decision can be unit tested deterministically.
 */
export function decideOutcome(
    configuration: ChaosServerConfiguration,
    random: () => number = Math.random,
): ChaosOutcome {
    if (random() < configuration.unavailable / 100) {
        return 'unavailable';
    }

    if (random() < configuration.connectionReset / 100) {
        return 'connectionReset';
    }

    return configuration.proxy ? 'proxy' : 'mock';
}

/** Parses the `x-chaosserver` header, falling back to `{}` on malformed JSON. */
export function parseHeaderSettings(raw: unknown): ChaosServerHeader {
    if (typeof raw !== 'string') {
        return {};
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed !== null && typeof parsed === 'object' ? (parsed as ChaosServerHeader) : {};
    } catch {
        return {};
    }
}

/** Merges stored settings with (possibly partial) overrides. */
export function mergeSettings(
    base: ChaosServerSettings,
    override?: ChaosServerHeader | null,
): ChaosServerSettings {
    return {
        configuration: { ...base.configuration, ...override?.configuration },
        response: { ...base.response, ...override?.response },
    };
}

/** Builds the in-memory state for a chaos server instance. */
export function createStorage(options: ChaosServerOptions = {}): ChaosServerStorage {
    const historySize = options.requestHistorySize ?? DEFAULT_REQUEST_HISTORY_SIZE;
    return {
        requests: new FixedSizeQueue<RecordedRequest>(historySize),
        settings: mergeSettings(DEFAULT_SETTINGS, options.settings),
    };
}

/** Forwards a request to `target`, stripping the chaos header first. */
export function proxyRequest(
    target: string,
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    try {
        unset(req.headers, CHAOS_SERVER_HEADER_NAME);
        createProxyMiddleware({
            target,
            changeOrigin: true, // for handling the virtual hosted sites.
        })(req, res, next);
    } catch (error) {
        res.status(500).send(`Error proxying the request[${target}]: ${(error as Error).message}`);
    }
}

/**
 * Creates a fully configured chaos server. Callers are responsible for
 * calling `app.listen(...)` - keeping that out of the factory makes the app
 * trivial to mount in tests.
 */
export function createApp(options: ChaosServerOptions = {}): ChaosServer {
    const app = express();
    const storage = createStorage(options);

    // request history
    app.get(REQUESTS_URL, (_req, res) => {
        res.status(200).send(storage.requests.getItems());
    });

    app.delete(REQUESTS_URL, (_req, res) => {
        storage.requests.clear();
        res.status(200).send({ success: true });
    });

    // settings
    app.get(SETTINGS_URL, (_req, res) => {
        res.status(200).send(storage.settings);
    });

    app.post(SETTINGS_URL, express.json(), (req, res) => {
        storage.settings = req.body as ChaosServerSettings;
        res.status(200).send({ success: true, settings: storage.settings });
    });

    // Middleware simulating network conditions. Registered after the admin
    // routes so those are never affected by the chaos configuration.
    app.use((req: Request, res: Response, next: NextFunction) => {
        storage.requests.enqueue({
            url: req.url,
            method: req.method,
            headers: req.headers,
            query: req.query,
            body: req.body,
            params: req.params,
        });

        const header = parseHeaderSettings(req.headers[CHAOS_SERVER_HEADER_NAME]);
        const { configuration, response } = mergeSettings(storage.settings, header);
        const { latency, proxy } = configuration;

        setTimeout(() => {
            switch (decideOutcome(configuration)) {
                case 'unavailable': // chance for 503 Service Unavailable error
                    res.status(503).send('Service Unavailable');
                    return;

                case 'connectionReset': // chance for connection reset
                    res.socket?.destroy();
                    return;

                case 'proxy': // get the configured proxy response
                    proxyRequest(proxy as string, req, res, next);
                    return;

                default: // get the configured mock response
                    res.status(response.status).send(response.body);
            }
        }, latency); // network latency
    });

    return { app, storage };
}
