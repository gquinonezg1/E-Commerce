import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/data-source';
import { User } from '../entities/User';
import { body, validationResult } from 'express-validator';
import { AuthService } from '../services/auth.service';

const userRepo = AppDataSource.getRepository(User);
const COOKIE_NAME = 'authToken';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

/**
 * Sets the authentication cookie on the response and returns the user object.
 * @private
 */
function setCookieAndRespond(res: Response, token: string, user: any): void {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,                                          // JS cannot read this cookie
        secure: process.env.NODE_ENV === 'production',          // HTTPS only in production
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',                                      // CSRF protection
        maxAge: COOKIE_MAX_AGE,
    });
    res.json({ message: 'Login successful', user });
}

/**
 * Handles new user registration.
 * @route POST /api/auth/register
 */
export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Check validation results from express-validator middleware
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const { name, email, password } = req.body;
        const user = await AuthService.register(name, email, password);

        res.status(201).json({
            message: 'Account created successfully',
            user,
        });
    } catch (err) {
        next(err); // Passes to global error handler declare in app.ts 500
    }
};

/**
 * Handles user authentication and session creation.
 * @route POST /api/auth/login
 */
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const error = validationResult(req);
        if (!error.isEmpty()) {
            res.status(401).json({ Error: error.array() });
            return;
        }

        const { email, password } = req.body;
        const { token, user } = await AuthService.login(email, password);

        setCookieAndRespond(res, token, user);

    } catch (error) {
        next(error);
    }
}

/**
 * Deletes a user account from the system by ID.
 * This is an administrative action that permanently removes the user record.
 * * @route DELETE /api/auth/users/:id
 * @param req.params.id - The unique numeric ID of the user to delete.
 * @returns 200 - Success message with deleted user details.
 * @returns 404 - If no user matches the provided ID.
 * @returns 500 - If a database or server error occurs.
 */
export const deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { id } = req.params;
        let user = await userRepo.findOne({ where: { id: parseInt(id as string) } });
        if (!user) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        await userRepo.remove(user);
        res.status(200).json({ message: "User deleted successfully", userId: id, name: user.name });
        return;
    } catch (err) {
        next(err);  // Passes the global error i.e declare in app.ts
    }
}

/**
 * Revokes the current session and clears the auth cookie.
 * @route POST /api/auth/logout
 */
export const logout = (req: Request, res: Response, next: NextFunction): void => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) AuthService.logout(token);
    res.clearCookie(COOKIE_NAME);
    res.json({ message: "Logout successfully" });
};

/**
 * Returns the currently authenticated user's profile.
 * @route GET /api/auth/me
 */
export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const user = await AuthService.getMe(req.user!.id);
        res.json({ user });
    } catch (err) {
        next(err);
    }
};

/**
 * Initiates the password recovery process by generating a reset code.
 * @route POST /api/auth/forgot-password
 */
export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { email } = req.body;
        if (!email) { res.status(400).json({ error: 'Email is required' }); return; }
        const code = await AuthService.forgotPassword(email);
        res.json({
            message: "Reset Code generate. In a real system this would be emailed.",
            resetCode: code
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Resets a user's password using a valid reset code.
 * @route POST /api/auth/reset-password
 */
export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { email, code, newPassword } = req.body;
        if (!email || !code || !newPassword) {
            res.status(400).json({ Error: "Email, Code, newPassword are required" });
            return;
        }
        if (newPassword < 8) {
            res.status(401).json({ Error: "Password must be at least 8 digit" });
            return;
        }
        await AuthService.resetPassword(email, code, newPassword);
        res.json({ message: "Password reset successfully" })

    } catch (err) {
        next(err);
    }
};

/**
 * export const register = async (req: Request, res: Response) => {
    const { name, email, password } = req.body;
    try {
        let user = await userRepo.findOne({ where: { email: email } });
        if (!user) {
            const passwordHash = await bcrypt.hash(password, 12);
            const newUser = userRepo.create({
                name,
                email,
                passwordHash
            });
            await userRepo.save(newUser);
            res.status(201).json({
                message: "User Registered Successfully",
                user: { id: newUser.id, email: newUser.email }
            })
        } else {
            res.status(400).json({ message: "User Already Exist" });
        }
    } catch (err) {
        console.error("Registration Error: ", err);
        res.status(500).json({
            message: "Registration Failed",
            error: "Error: ", err
        });
    }
};
 */

/**
 * export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const userRepo = await AppDataSource.getRepository(User);
    try {
        let user = await userRepo.findOne({ where: { email: email } });
        if (user) {
            const isPassword = await bcrypt.compare(password, user.passwordHash);
            if (!isPassword) {
                // Added 'return' so it stops here if password is wrong
                return res.status(401).json({
                    message: "Invalid Credential",
                    error: "Incorrect Password"
                });
            }
        } else {
            return res.status(401).json({
                message: "Invalid Credential",
                error: "User Not Exist"
            });
        }
        // This only runs if the 'if' and 'else' above didn't trigger a return
        return res.status(201).json({
            message: "Login Successfull",
            user: { id: user.id, email: user.email, name: user.name }
        })
    }
    catch (err) {
        res.status(500).json({
            message: "Login failed",
            error: `Error: ${err}`
        });
    }
}
 */
