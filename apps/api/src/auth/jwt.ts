import jwt from "jsonwebtoken";
import { env } from "../env";

export interface AuthTokenPayload {
    userId: string;
    tenantId: string;
}

export function signToken(payload: AuthTokenPayload): string {
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthTokenPayload {
    return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
}