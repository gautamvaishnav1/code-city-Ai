declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        /** true for anonymous demo sessions — see requireDemoForGuest */
        guest?: boolean;
      };
    }
  }
}

export {};
