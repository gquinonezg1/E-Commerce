import strict from "node:assert/strict";
import { AppDataSource } from "../config/data-source";
import { User, UserRole } from "../entities/User";
import bcrypt from "bcrypt";
import jwt from 'jsonwebtoken';
import { SessionStore } from "../middleware/sessionStore";
import { forgotPassword, resetPassword } from "../controllers/auth.controller";
import { ResetCode } from "../entities/ResetCode";
import { Code } from "typeorm";

const SALT_ROUND = 12;
const JWT_EXPIRES_IN = '7d';
const RESET_CODE_EXPIRY_MINUTES = 10;

/**
   * Registers a new customer account.
   * Validates uniqueness, hashes the password, persists the user.
   * Returns the created user (without passwordHash).
   */
/*
* In simple terms, Omit is a TypeScript "Utility Type" that acts like a filter for your objects. 
   * It tells TypeScript: "Takethe User type, but remove the passwordHash property from it."
   * Why do we use it?
   * When you define your User entity, it includes the passwordHash. However, in your AuthService.register, 
   * you are returning the user data to the frontend.
   * You never, ever want to send a password hash to the frontend, even if it's hashed. By using Omit, you are creating a "Safe
   * User" type for your return value.* */
export const AuthService = {
    /**
     * Creates a new user record in the database.
     * @param name - Raw display name
     * @param email - User email (will be normalized)
     * @param password - Plain text password (will be hashed)
     * @throws {Error} 409 if email is already registered
     */
    async register(name: string, email: string, password: string): Promise<Omit<User, 'passwordHash'>> {
        const normalisedEmail = email.toLowerCase().trim();
        const userRepo = await AppDataSource.getRepository(User);
        const existing = await userRepo.findOne({ where: { email: normalisedEmail } });
        if (existing) {
            const error: any = new Error('An account with this email already exists');
            error.status = 409; // 409 Conflict — resource already exists
            throw error;
        }
        const passwordHash = await bcrypt.hash(password, SALT_ROUND);
        const user = userRepo.create({
            name: name.trim(),
            email: normalisedEmail,
            passwordHash,
            role: UserRole.CUSTOMER,
            isLocked: false
        });

        const saved = await userRepo.save(user);

        // Strip passwordHash before returning — never send it over the wire
        const { passwordHash: _, ...safeUser } = saved;
        return safeUser as Omit<User, 'passwordHash'>;
    },

    /**
     * Authenticates a user and generates a JWT session.
     * @returns Object containing the JWT token and safe User data
     * @throws {Error} 403 if credentials invalid or account locked
     */
    async login(email: string, password: string): Promise<{ token: string; user: Omit<User, 'passwordHash'> }> {
        const userRepo = await AppDataSource.getRepository(User);
        const normalisedEmail = email.toLowerCase().trim();
        const user = await userRepo.findOne({ where: { email: normalisedEmail } });
        console.log("LOGIN DEBUG:", {
    email: normalisedEmail,
    userFound: !!user,
    hasPasswordHash: !!user?.passwordHash,
});
        const isMatch = await bcrypt.compare(password, user?.passwordHash!);

        if (!user || !isMatch) {
            const error: any = new Error("Invalid Credential");
            error.status = 403;
            throw error;
        }

        if (user.isLocked) {
            const error: any = new Error("Your Account is Locked");
            error.status = 403;
            throw error;
        }

        const token = jwt.sign(
            {
                userId: user.id,
                role: user.role,
                email: user.email
            },
            process.env.JWT_SECRET!,
            {
                expiresIn: JWT_EXPIRES_IN
            }
        )

        SessionStore.set(token, {
            userId: user.id,
            role: user.role,
            email: user.email
        })

        const { passwordHash: _, ...safeUser } = user;
        return { token, user: safeUser as Omit<User, 'passwordHash'> };
    },

    /**
     * Invalidates a session token in the SessionStore.
     */
    logout(token: string): void {
        SessionStore.deleteToken(token);
    },

    /**
     * Fetches a safe user profile by ID.
     * @throws {Error} 404 if user does not exist
     */
    async getMe(userId: number): Promise<Omit<User, 'passwordHash'>> {
        const userRepo = AppDataSource.getRepository(User);
        const user = await userRepo.findOne({ where: { id: userId } });

        if (!user) {
            const error: any = new Error("User not found");
            error.status = 404;
            throw error;
        }

        const { passwordHash: _, ...safeUser } = user;
        return safeUser as Omit<User, 'passwordHash'>;
    },

    /**
     * Generates a 6-digit verification code for password resets.
     * Invalidates any previous pending codes for the user.
     */
    async forgotPassword(email: string): Promise<string> {
        const userRepo = await AppDataSource.getRepository(User);
        const resetRepo = await AppDataSource.getRepository(ResetCode);
        const normalisedEmail = email.toLowerCase().trim();
        const user = await userRepo.findOne({ where: { email: normalisedEmail } });

        if (!user) {
            return '0000';
        }

        const existingCode = await resetRepo.find({ where: { user: { id: user.id }, used: false } });
        for (const code of existingCode) {
            code.used = true,
                await resetRepo.save(code);
        }

        // Generate 6 digit code
        // Generates a number between 100,000 and 999,999
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + RESET_CODE_EXPIRY_MINUTES);
        const resetCode = resetRepo.create({ user, code, expiresAt, used: false });
        await resetRepo.save(resetCode);

        return code;

    },

    /**
     * Validates reset code and updates user password.
     * Clears all active sessions for the user upon success.
     * @throws {Error} 400 if code is invalid, used, or expired
     */
    async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
        const userRepo = await AppDataSource.getRepository(User);
        const resetRepo = await AppDataSource.getRepository(ResetCode);

        const normalisedEmail = email.toLowerCase().trim();
        const user = await userRepo.findOne({ where: { email: normalisedEmail } });

        if (!user) {
            const error: any = new Error("User Not Found");
            error.status = 400;
            throw error;
        }

        const resetCode = await resetRepo.findOne({ where: { user: { id: user.id }, code, used: false } });

        if (!resetCode) {
            const error: any = new Error('Invalid or already used reset code');
            error.status = 400;
            throw error;
        }

        if (new Date() > resetCode.expiresAt) {
            const error: any = new Error("Reset code is expired. Please request a new one");
            error.status = 400;
            throw error;
        }

        user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUND);

        resetCode.used = true;
        await userRepo.save(resetCode);
        await userRepo.save(user);

        SessionStore.deleteAllForUser(user.id);
    }
}


/**
 * {
  id: number;
  name: string;
  email: string;
  role: string;
  passwordHash: string; // The "dangerous" part
}

* {
  id: number;
  name: string;
  email: string;
  role: string;
  // passwordHash is GONE!
}
 */