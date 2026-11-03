import type { FastifyRequest } from 'fastify';
export interface Actor { userId: string; sessionId: string; roles: string[]; capabilities: string[]; mustChangePassword: boolean }
export type AuthRequest = FastifyRequest & { actor: Actor };
export interface UserDto { id: string; username: string | null; displayName: string; fullName: string; employeeCode: string | null; roles: string[]; synthetic: boolean; active: boolean; isActive: boolean; mustChangePassword: boolean }
