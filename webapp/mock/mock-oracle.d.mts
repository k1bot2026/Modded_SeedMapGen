import type { Server } from "node:http";

export interface MockOracleOptions {
  seed?: string;
}

/** Create the mock oracle HTTP server (not yet listening). */
export declare function createMockOracle(options?: MockOracleOptions): Server;
