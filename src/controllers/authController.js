import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import VerificationCode from '../models/VerificationCode.js';
import PasswordReset from '../models/PasswordReset.js';
import { generateToken } from '../config/jwt.js';
import { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } from '../utils/email.js';
import crypto from 'crypto';

export const register = async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      passwordHash: hashedPassword,
      firstName,
      lastName,
      phone: phone || null,
      role: 'member',
      verified: false,
    });

    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    await VerificationCode.create({
      userId: user._id,
      code: verificationCode,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    // Send verification email
    await sendVerificationEmail(email, firstName, verificationCode);

    res.status(201).json({
      message: 'User registered successfully. Verification code sent to email.',
      email: user.email,
      requiresVerification: true,
      verificationExpires: '10 minutes',
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code required' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Find and verify code
    const verificationRecord = await VerificationCode.findOne({
      userId: user._id,
      code,
      expiresAt: { $gt: new Date() },
    });

    if (!verificationRecord) {
      return res.status(401).json({ error: 'Invalid or expired verification code' });
    }

    // Mark user as verified
    user.verified = true;
    await user.save();

    // Delete verification codes
    await VerificationCode.deleteMany({ userId: user._id });

    // Generate token for immediate login after verification
    const token = generateToken(user._id.toString(), user.role);

    res.json({
      message: 'Email verified successfully',
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
};

export const resendVerificationCode = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete old codes
    await VerificationCode.deleteMany({ userId: user._id });

    // Generate new code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    await VerificationCode.create({
      userId: user._id,
      code: verificationCode,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    res.json({ message: 'Verification code sent' });
  } catch (error) {
    console.error('Resend error:', error);
    res.status(500).json({ error: 'Failed to resend code' });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if email is verified
    if (!user.verified) {
      return res.status(403).json({ error: 'Please verify your email first' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user._id.toString(), user.role);

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if email exists for security
      return res.json({ message: 'If account exists, reset link has been sent' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    await PasswordReset.create({
      userId: user._id,
      token: hashedToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    // Send password reset email
    await sendPasswordResetEmail(email, user.firstName, resetToken);

    res.json({ message: 'If account exists, reset link has been sent' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token: resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: 'Token and new password required' });
    }

    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    const resetRecord = await PasswordReset.findOne({
      token: hashedToken,
      expiresAt: { $gt: new Date() },
    });

    if (!resetRecord) {
      return res.status(401).json({ error: 'Invalid or expired reset token' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    const user = await User.findByIdAndUpdate(
      resetRecord.userId,
      { passwordHash: hashedPassword },
      { new: true }
    );

    // Delete reset token
    await PasswordReset.deleteMany({ userId: resetRecord.userId });

    // Generate token to log user in
    const token = generateToken(user._id.toString(), user.role);

    res.json({
      message: 'Password reset successfully',
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};

export default {
  register,
  verifyEmail,
  resendVerificationCode,
  login,
  forgotPassword,
  resetPassword,
};
