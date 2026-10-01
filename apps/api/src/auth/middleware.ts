import { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt";

export interface AuthedRequest extends Request {
    auth?: { userId: string, tenantId: string };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }
    try {
        const payload = verifyToken(header.slice("Bearer ".length));
        req.auth = { userId: payload.userId, tenantId: payload.tenantId };
        next();
    } catch {
        res.status(401).json({ error: "Invalid or expired token" });
    }
}