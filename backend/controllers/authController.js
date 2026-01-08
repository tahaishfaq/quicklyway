const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { HTTP_STATUS } = require('@quicklyway/shared');
const { sendPasswordResetEmail } = require('../utils/emailService');

/**
 * Sign up a new user
 */
exports.signup = async (req, res, next) => {
    try {
        const { name, email, password } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                message: 'A user with this email already exists.',
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Create user
        const user = await User.create({
            name,
            email,
            password: hashedPassword,
        });

        // Generate JWTs
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        const refreshToken = jwt.sign(
            { id: user._id },
            process.env.JWT_REFRESH_SECRET || 'refresh_secret',
            { expiresIn: '7d' }
        );

        // Save refresh token
        user.refreshToken = refreshToken;
        await user.save();

        res.status(HTTP_STATUS.CREATED).json({
            message: 'User registered successfully.',
            token,
            refreshToken,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isSeller: user.isSeller,
                sellerStatus: user.sellerStatus,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Log in an existing user
 */
exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // Find user and include password
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                message: 'Invalid email or password.',
            });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                message: 'Invalid email or password.',
            });
        }

        // Generate JWTs
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        const refreshToken = jwt.sign(
            { id: user._id },
            process.env.JWT_REFRESH_SECRET || 'refresh_secret',
            { expiresIn: '7d' }
        );

        // Save refresh token
        user.refreshToken = refreshToken;
        await user.save();

        res.status(HTTP_STATUS.OK).json({
            message: 'Logged in successfully.',
            token,
            refreshToken,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isSeller: user.isSeller,
                sellerStatus: user.sellerStatus,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get current user profile
 */
exports.getMe = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                message: 'User not found.',
            });
        }

        res.status(HTTP_STATUS.OK).json({
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isSeller: user.isSeller,
                sellerStatus: user.sellerStatus,
                rejectionReason: user.rejectionReason,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Refresh tokens
 */
exports.refresh = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                message: 'Refresh token is required.',
            });
        }

        // Verify refresh token
        const decoded = jwt.verify(
            refreshToken,
            process.env.JWT_REFRESH_SECRET || 'refresh_secret'
        );

        // Find user and check if refresh token matches
        const user = await User.findById(decoded.id).select('+refreshToken');
        if (!user || user.refreshToken !== refreshToken) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                message: 'Invalid refresh token.',
            });
        }

        // Generate new JWTs
        const newToken = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        const newRefreshToken = jwt.sign(
            { id: user._id },
            process.env.JWT_REFRESH_SECRET || 'refresh_secret',
            { expiresIn: '7d' }
        );

        // Update refresh token
        user.refreshToken = newRefreshToken;
        await user.save();

        res.status(HTTP_STATUS.OK).json({
            token: newToken,
            refreshToken: newRefreshToken,
        });
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                message: 'Invalid or expired refresh token. Please login again.',
            });
        }
        next(error);
    }
};

/**
 * Forgot password - Generate reset token
 */
exports.forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                message: 'Email is required.',
            });
        }

        const user = await User.findOne({ email });
        
        // Always return success to prevent email enumeration
        if (!user) {
            return res.status(HTTP_STATUS.OK).json({
                message: 'If an account with that email exists, a password reset link has been sent.',
            });
        }

        // Generate reset token
        const resetToken = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '1h' }
        );

        // Set reset token and expiration (1 hour from now)
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpire = new Date(Date.now() + 3600000); // 1 hour
        await user.save({ validateBeforeSave: false });

        // Generate reset URL
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
        
        try {
            // Send password reset email
            await sendPasswordResetEmail(user.email, resetUrl, user.name);
            
            // In development, also log the URL for testing
            if (process.env.NODE_ENV === 'development') {
                console.log('Password reset URL:', resetUrl);
            }
        } catch (emailError) {
            // Log error but don't fail the request (security: don't reveal if email exists)
            console.error('Failed to send password reset email:', emailError);
            // Still return success to prevent email enumeration
        }

        res.status(HTTP_STATUS.OK).json({
            message: 'If an account with that email exists, a password reset link has been sent.',
            // Only include in development for testing
            ...(process.env.NODE_ENV === 'development' && { resetUrl }),
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Reset password with token
 */
exports.resetPassword = async (req, res, next) => {
    try {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                message: 'Token and password are required.',
            });
        }

        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        } catch (error) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                message: 'Invalid or expired reset token.',
            });
        }

        // Find user with reset token
        const user = await User.findById(decoded.id).select('+resetPasswordToken +resetPasswordExpire');
        
        if (!user) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                message: 'User not found.',
            });
        }

        // Check if token matches and hasn't expired
        if (user.resetPasswordToken !== token || !user.resetPasswordExpire || user.resetPasswordExpire < new Date()) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                message: 'Invalid or expired reset token.',
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Update password and clear reset token
        user.password = hashedPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save();

        res.status(HTTP_STATUS.OK).json({
            message: 'Password has been reset successfully.',
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update user profile
 */
exports.updateProfile = async (req, res, next) => {
    try {
        const { name, email } = req.body;
        const userId = req.user.id;

        // Build update object
        const updateData = {};
        if (name) updateData.name = name.trim();
        if (email) {
            // Check if email is already taken by another user
            const existingUser = await User.findOne({ email, _id: { $ne: userId } });
            if (existingUser) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    message: 'Email is already taken by another user.',
                });
            }
            updateData.email = email.toLowerCase().trim();
        }

        // Update user
        const user = await User.findByIdAndUpdate(
            userId,
            updateData,
            { new: true, runValidators: true }
        );

        if (!user) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                message: 'User not found.',
            });
        }

        res.status(HTTP_STATUS.OK).json({
            message: 'Profile updated successfully.',
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isSeller: user.isSeller,
                sellerStatus: user.sellerStatus,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Change password (for authenticated users)
 */
exports.changePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        if (!currentPassword || !newPassword) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                message: 'Current password and new password are required.',
            });
        }

        // Find user with password
        const user = await User.findById(userId).select('+password');
        if (!user) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                message: 'User not found.',
            });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                message: 'Current password is incorrect.',
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        // Update password
        user.password = hashedPassword;
        await user.save();

        res.status(HTTP_STATUS.OK).json({
            message: 'Password changed successfully.',
        });
    } catch (error) {
        next(error);
    }
};
