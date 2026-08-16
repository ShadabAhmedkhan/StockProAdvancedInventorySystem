declare global {
  namespace Express {
    interface Request {
      /**
       * Correlation id for this request. Assigned by `requestIdMiddleware`,
       * which is the first middleware registered on the Express instance, so
       * it is present for the whole lifetime of every request.
       */
      requestId: string;
    }
  }
}

export {};
