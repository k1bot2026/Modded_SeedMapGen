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

export class HashMismatchError extends UserError {
  constructor(
    readonly url: string,
    readonly algorithm: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `${algorithm} mismatch for ${url}\n  expected ${expected}\n  actual   ${actual}\n` +
        `The download is corrupt or tampered with; the file was discarded.`,
    );
    this.name = "HashMismatchError";
  }
}
