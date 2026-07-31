export class AppError extends Error {
  constructor(stage, message) {
    super(message);
    this.name = 'AppError';
    this.stage = stage;
  }
}
