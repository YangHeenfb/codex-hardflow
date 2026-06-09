export class HardflowError extends Error {
  constructor(
    message: string,
    public readonly code = "HARDFLOW_ERROR"
  ) {
    super(message);
    this.name = "HardflowError";
  }
}
