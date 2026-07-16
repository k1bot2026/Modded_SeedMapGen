/** An error whose message is meant for the end user; the CLI prints it without a stack. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "UserError";
  }
}

/** The oracle could not be reached at all (connection refused, DNS, ...). */
export class OracleUnreachableError extends UserError {
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    super(
      `Cannot reach the oracle at ${url} (${cause instanceof Error ? cause.message : String(cause)}).\n` +
        `Is it running? Start one with: seedmap run <runDir> --seed <seed> --accept-eula`,
    );
    this.name = "OracleUnreachableError";
  }
}

/** A non-2xx oracle response, parsed from the contract's error envelope. */
export class OracleHttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    /** snake_case code from the contract (bad_param, not_found, ...) or "http_<status>". */
    readonly code: string,
    message: string,
  ) {
    super(`oracle ${status} ${code} for ${url}: ${message}`);
    this.name = "OracleHttpError";
  }
}

/** The oracle answered 2xx but the body violates docs/oracle-api.md. */
export class ContractViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractViolationError";
  }
}

/** Fixture file missing/invalid; exit code 2 keeps it distinct from validation failures. */
export class FixtureError extends UserError {
  constructor(message: string) {
    super(message, 2);
    this.name = "FixtureError";
  }
}
