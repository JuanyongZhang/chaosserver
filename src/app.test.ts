import express, { Express, NextFunction, Request, Response } from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import {
    CHAOS_SERVER_HEADER_NAME,
    DEFAULT_REQUEST_HISTORY_SIZE,
    DEFAULT_SETTINGS,
    REQUESTS_URL,
    SETTINGS_URL,
    createApp,
    createStorage,
    decideOutcome,
    mergeSettings,
    parseHeaderSettings,
    proxyRequest,
} from './app';
import { ChaosServerConfiguration, RecordedRequest } from './types';

jest.mock('http-proxy-middleware', () => {
    const actual = jest.requireActual('http-proxy-middleware');
    return { ...actual, createProxyMiddleware: jest.fn(actual.createProxyMiddleware) };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createProxyMiddleware } = require('http-proxy-middleware') as {
    createProxyMiddleware: jest.Mock;
};

/** Settings with all chaos disabled by default so tests run fast and deterministically. */
function testSettings(overrides: Partial<ChaosServerConfiguration> = {}) {
    return {
        configuration: { latency: 0, connectionReset: 0, unavailable: 0, ...overrides },
    };
}

/** Starts an app on an ephemeral port and returns the port plus a stop helper. */
async function listen(app: Express): Promise<{ port: number; stop: () => Promise<void> }> {
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const { port } = server.address() as AddressInfo;

    return {
        port,
        stop: async () => {
            server.closeAllConnections?.();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}

describe('decideOutcome', () => {
    it('returns unavailable when the unavailable percentage is hit', () => {
        const configuration: ChaosServerConfiguration = {
            latency: 0,
            connectionReset: 0,
            unavailable: 100,
        };

        expect(decideOutcome(configuration, () => 0)).toBe('unavailable');
    });

    it('returns connectionReset when only the connection reset percentage is hit', () => {
        const configuration: ChaosServerConfiguration = {
            latency: 0,
            unavailable: 0,
            connectionReset: 100,
        };

        expect(decideOutcome(configuration, () => 0)).toBe('connectionReset');
    });

    it('returns proxy when a proxy target is configured and no fault is hit', () => {
        const configuration: ChaosServerConfiguration = {
            latency: 0,
            connectionReset: 0,
            unavailable: 0,
            proxy: 'http://localhost:8080',
        };

        expect(decideOutcome(configuration, () => 0.99)).toBe('proxy');
    });

    it('returns mock when no proxy is configured and no fault is hit', () => {
        const configuration: ChaosServerConfiguration = {
            latency: 0,
            connectionReset: 0,
            unavailable: 0,
        };

        expect(decideOutcome(configuration, () => 0.99)).toBe('mock');
    });

    it('treats a percentage equal to the random value as not hit', () => {
        const configuration: ChaosServerConfiguration = {
            latency: 0,
            connectionReset: 0,
            unavailable: 50,
        };

        // 0.5 < 0.5 is false, so 50% means "strictly below 0.5".
        expect(decideOutcome(configuration, () => 0.5)).toBe('mock');
    });

    it('does not evaluate the connection reset roll when unavailable already hit', () => {
        const configuration: ChaosServerConfiguration = {
            latency: 0,
            connectionReset: 100,
            unavailable: 100,
        };
        const random = jest.fn(() => 0);

        expect(decideOutcome(configuration, random)).toBe('unavailable');
        expect(random).toHaveBeenCalledTimes(1);
    });

    it('defaults to Math.random', () => {
        const configuration: ChaosServerConfiguration = {
            latency: 0,
            connectionReset: 0,
            unavailable: 0,
        };

        expect(['mock', 'unavailable', 'connectionReset']).toContain(decideOutcome(configuration));
    });
});

describe('parseHeaderSettings', () => {
    it('parses a JSON header value', () => {
        const parsed = parseHeaderSettings('{"configuration":{"latency":10}}');

        expect(parsed).toEqual({ configuration: { latency: 10 } });
    });

    it('falls back to an empty object for malformed JSON', () => {
        expect(parseHeaderSettings('not-json')).toEqual({});
    });

    it('falls back to an empty object for a missing header', () => {
        expect(parseHeaderSettings(undefined)).toEqual({});
    });

    it('falls back to an empty object for JSON that is not an object', () => {
        expect(parseHeaderSettings('42')).toEqual({});
        expect(parseHeaderSettings('null')).toEqual({});
    });
});

describe('mergeSettings', () => {
    it('returns the base settings when there is no override', () => {
        expect(mergeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    });

    it('merges partial overrides without dropping the untouched fields', () => {
        const merged = mergeSettings(DEFAULT_SETTINGS, { configuration: { latency: 5 } });

        expect(merged.configuration).toEqual({ ...DEFAULT_SETTINGS.configuration, latency: 5 });
        expect(merged.response).toEqual(DEFAULT_SETTINGS.response);
    });

    it('merges partial response overrides', () => {
        const merged = mergeSettings(DEFAULT_SETTINGS, { response: { status: 418 } });

        expect(merged.response.status).toBe(418);
        expect(merged.response.body).toEqual(DEFAULT_SETTINGS.response.body);
    });
});

describe('createStorage', () => {
    it('uses the documented defaults when no options are given', () => {
        const storage = createStorage();

        expect(storage.settings).toEqual(DEFAULT_SETTINGS);
        expect(storage.requests.maxSize).toBe(DEFAULT_REQUEST_HISTORY_SIZE);
        expect(storage.requests.size).toBe(0);
    });

    it('merges the provided options over the defaults', () => {
        const storage = createStorage({
            requestHistorySize: 5,
            settings: { configuration: { latency: 0 } },
        });

        expect(storage.requests.maxSize).toBe(5);
        expect(storage.settings.configuration).toEqual({
            ...DEFAULT_SETTINGS.configuration,
            latency: 0,
        });
    });
});

describe('proxyRequest', () => {
    it('returns 500 with the target when the proxy middleware throws', () => {
        createProxyMiddleware.mockImplementationOnce(() => {
            throw new Error('boom');
        });

        const req = { headers: { [CHAOS_SERVER_HEADER_NAME]: '{"configuration":{}}' } } as unknown as Request;
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn(),
        } as unknown as Response;

        expect(() => proxyRequest('invalid-target', req, res, jest.fn() as NextFunction)).not.toThrow();
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(
            expect.stringContaining('Error proxying the request[invalid-target]'),
        );
    });

    it('strips the chaos header before proxying', () => {
        const next = jest.fn() as NextFunction;
        const req = {
            headers: { [CHAOS_SERVER_HEADER_NAME]: '{"configuration":{}}' },
        } as unknown as Request;

        proxyRequest('http://localhost:1', req, {} as Response, next);

        expect(req.headers[CHAOS_SERVER_HEADER_NAME]).toBeUndefined();
    });
});

describe('createApp - admin endpoints', () => {
    it('returns the default settings', async () => {
        const { app } = createApp();

        const res = await request(app).get(SETTINGS_URL);

        expect(res.status).toBe(200);
        expect(res.body).toEqual(DEFAULT_SETTINGS);
    });

    it('replaces the stored settings', async () => {
        const { app, storage } = createApp();
        const updated = {
            configuration: { latency: 10, connectionReset: 0, unavailable: 0 },
            response: { status: 201, body: { created: true } },
        };

        const res = await request(app).post(SETTINGS_URL).send(updated);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, settings: updated });
        expect(storage.settings).toEqual(updated);

        const current = await request(app).get(SETTINGS_URL);
        expect(current.body).toEqual(updated);
    });

    it('is never affected by the chaos configuration', async () => {
        const { app } = createApp({ settings: testSettings({ unavailable: 100, latency: 0 }) });

        const res = await request(app).get(SETTINGS_URL);

        expect(res.status).toBe(200);
    });

    it('does not record admin requests in the history', async () => {
        const { app } = createApp({ settings: testSettings() });

        await request(app).get(SETTINGS_URL);

        const res = await request(app).get(REQUESTS_URL);
        expect(res.body).toEqual([]);
    });
});

describe('createApp - mock responses', () => {
    it('returns the configured mock response', async () => {
        const { app } = createApp({ settings: testSettings() });

        const res = await request(app).get('/api/ping');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
    });

    it('uses the response stored through the settings endpoint', async () => {
        const { app } = createApp({ settings: testSettings() });
        await request(app)
            .post(SETTINGS_URL)
            .send({
                configuration: { latency: 0, connectionReset: 0, unavailable: 0 },
                response: { status: 201, body: { created: true } },
            });

        const res = await request(app).get('/api/ping');

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ created: true });
    });

    it('applies per-request response overrides from the header', async () => {
        const { app } = createApp({ settings: testSettings() });

        const res = await request(app)
            .get('/api/ping')
            .set(CHAOS_SERVER_HEADER_NAME, JSON.stringify({ response: { status: 418, body: { teapot: true } } }));

        expect(res.status).toBe(418);
        expect(res.body).toEqual({ teapot: true });
    });

    it('applies per-request configuration overrides from the header', async () => {
        const { app } = createApp({ settings: testSettings() });

        const res = await request(app)
            .get('/api/ping')
            .set(CHAOS_SERVER_HEADER_NAME, JSON.stringify({ configuration: { unavailable: 100 } }));

        expect(res.status).toBe(503);
    });

    it('ignores a malformed chaos header', async () => {
        const { app } = createApp({ settings: testSettings() });

        const res = await request(app).get('/api/ping').set(CHAOS_SERVER_HEADER_NAME, '{oops');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
    });
});

describe('createApp - chaos injection', () => {
    it('always returns 503 when unavailable is 100', async () => {
        const { app } = createApp({ settings: testSettings({ unavailable: 100 }) });

        const res = await request(app).get('/api/ping');

        expect(res.status).toBe(503);
        expect(res.text).toBe('Service Unavailable');
    });

    it('never returns 503 when unavailable is 0', async () => {
        const { app } = createApp({ settings: testSettings({ unavailable: 0 }) });

        const res = await request(app).get('/api/ping');

        expect(res.status).toBe(200);
    });

    it('waits for the configured latency before responding', async () => {
        const { app } = createApp({ settings: testSettings({ latency: 120 }) });

        const started = Date.now();
        const res = await request(app).get('/api/ping');
        const elapsed = Date.now() - started;

        expect(res.status).toBe(200);
        expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    it('destroys the socket when connectionReset is 100', async () => {
        const { app } = createApp({ settings: testSettings({ connectionReset: 100 }) });
        const { port, stop } = await listen(app);

        try {
            const error = await new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
                const req = http.get({ host: '127.0.0.1', port, path: '/api/ping' }, (res) => {
                    res.resume();
                    res.on('end', () => resolve(undefined));
                    res.on('close', () => resolve(undefined));
                });
                req.on('error', (err: NodeJS.ErrnoException) => resolve(err));
            });

            expect(error).toBeDefined();
            expect(['ECONNRESET', 'ECONNABORTED', 'EPIPE']).toContain(error?.code);
        } finally {
            await stop();
        }
    });
});

describe('createApp - request history', () => {
    it('records the requests that reach the chaos middleware', async () => {
        const { app } = createApp({ settings: testSettings() });

        await request(app).get('/api/ping?foo=bar').set(CHAOS_SERVER_HEADER_NAME, '{}');

        const res = await request(app).get(REQUESTS_URL);
        const history = res.body as RecordedRequest[];

        expect(res.status).toBe(200);
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ url: '/api/ping?foo=bar', method: 'GET' });
    });

    it('caps the history at the configured size keeping the newest entries', async () => {
        const { app } = createApp({ settings: testSettings(), requestHistorySize: 2 });

        await request(app).get('/api/1');
        await request(app).get('/api/2');
        await request(app).get('/api/3');

        const res = await request(app).get(REQUESTS_URL);
        const history = res.body as RecordedRequest[];

        expect(history.map((entry) => entry.url)).toEqual(['/api/2', '/api/3']);
    });

    it('clears the history on DELETE', async () => {
        const { app, storage } = createApp({ settings: testSettings() });
        await request(app).get('/api/ping');

        const res = await request(app).delete(REQUESTS_URL);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
        expect(storage.requests.size).toBe(0);

        const after = await request(app).get(REQUESTS_URL);
        expect(after.body).toEqual([]);
    });
});

describe('createApp - proxying', () => {
    it('forwards the request to the configured target and strips the chaos header', async () => {
        const upstream = express();
        let seenChaosHeader: unknown = 'not-called';
        upstream.get('/api/ping', (req, res) => {
            seenChaosHeader = req.headers[CHAOS_SERVER_HEADER_NAME];
            res.status(200).json({ from: 'upstream' });
        });

        const { port: upstreamPort, stop } = await listen(upstream);
        const target = `http://127.0.0.1:${upstreamPort}`;

        try {
            const { app } = createApp({ settings: testSettings({ proxy: target }) });

            const res = await request(app)
                .get('/api/ping')
                .set(CHAOS_SERVER_HEADER_NAME, JSON.stringify({ configuration: { proxy: target } }));

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ from: 'upstream' });
            expect(seenChaosHeader).toBeUndefined();
        } finally {
            await stop();
        }
    });
});
