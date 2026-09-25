import FixedSizeQueue from './commons/fixedSizeArray';

/** Network conditions applied to every (non-admin) request. */
export interface ChaosServerConfiguration {
    /** Milliseconds to wait before responding. */
    latency: number;
    /** Percentage chance (0-100) of destroying the connection. */
    connectionReset: number;
    /** Percentage chance (0-100) of returning `503 Service Unavailable`. */
    unavailable: number;
    /** Optional upstream URL. When set, the request is proxied instead of mocked. */
    proxy?: string;
}

/** Canned response returned for mocked requests. */
export interface ChaosServerResponse {
    status: number;
    body: object;
}

/** Stored, server-wide chaos settings. */
export interface ChaosServerSettings {
    configuration: ChaosServerConfiguration;
    response: ChaosServerResponse;
}

/** Per-request overrides parsed from the `x-chaosserver` header. */
export interface ChaosServerHeader {
    configuration?: Partial<ChaosServerConfiguration>;
    response?: Partial<ChaosServerResponse>;
}

/** In-memory state of a chaos server instance. */
export interface ChaosServerStorage {
    requests: FixedSizeQueue<RecordedRequest>;
    settings: ChaosServerSettings;
}

/** A single entry in the recorded request history. */
export interface RecordedRequest {
    url: string;
    method: string;
    headers: unknown;
    query: unknown;
    body: unknown;
    params: unknown;
}

/** Options accepted by {@link createApp}. */
export interface ChaosServerOptions {
    /** Deep-partial overrides merged over the default settings. */
    settings?: Partial<{
        configuration: Partial<ChaosServerConfiguration>;
        response: Partial<ChaosServerResponse>;
    }>;
    /** Maximum number of requests kept in the history (default 50). */
    requestHistorySize?: number;
}
