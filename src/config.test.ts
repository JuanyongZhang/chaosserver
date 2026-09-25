import { DEFAULT_PORT, PORT_ENV_VAR, resolvePort } from './config';

describe('resolvePort', () => {
    it('falls back to the default port when the value is unset', () => {
        expect(resolvePort(undefined)).toBe(DEFAULT_PORT);
    });

    it('falls back to the default port for blank values', () => {
        expect(resolvePort('')).toBe(DEFAULT_PORT);
        expect(resolvePort('   ')).toBe(DEFAULT_PORT);
    });

    it('uses an explicit fallback when provided', () => {
        expect(resolvePort(undefined, 3000)).toBe(3000);
    });

    it('parses a numeric value', () => {
        expect(resolvePort('8080')).toBe(8080);
        expect(resolvePort(' 8080 ')).toBe(8080);
    });

    it('accepts the valid port boundaries', () => {
        expect(resolvePort('0')).toBe(0);
        expect(resolvePort('65535')).toBe(65535);
    });

    it.each(['abc', '80.5', '-1', '65536', 'NaN', '{}'])('throws for "%s"', (raw) => {
        expect(() => resolvePort(raw)).toThrow(/Invalid PORT value/);
    });

    it('mentions the offending value and env var in the error', () => {
        expect(() => resolvePort('nope')).toThrow(
            `Invalid ${PORT_ENV_VAR} value "nope"`,
        );
    });

    it('reads the documented environment variable name', () => {
        expect(PORT_ENV_VAR).toBe('PORT');
    });

    it('defaults to the documented port', () => {
        expect(DEFAULT_PORT).toBe(13526);
    });
});
