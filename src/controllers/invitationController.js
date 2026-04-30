import crypto from 'crypto';
import Invitation from '../models/Invitation.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import { generateToken } from '../config/jwt.js';
import { sendInviteEmail } from '../utils/email.js';
import bcrypt from 'bcryptjs';

export const sendInvite = async (req, res) => {
  const { email } = req.body;
  const organizationId = req.user.organizationId;
  const invitedBy = req.user.userId || req.user.id;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check if user already exists in this org
  const existingUser = await User.findOne({ email: normalizedEmail, organizationId });
  if (existingUser) {
    return res.status(400).json({ error: 'A user with this email already exists in your organization' });
  }

  // Check if there is already a pending invite for this email
  const existingInvite = await Invitation.findOne({
    organizationId,
    email: normalizedEmail,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  });
  if (existingInvite) {
    return res.status(400).json({ error: 'A pending invitation already exists for this email' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const invitation = await Invitation.create({
    email: normalizedEmail,
    organizationId,
    role: 'admin',
    token,
    status: 'pending',
    expiresAt,
    invitedBy,
  });

  // Fetch inviter and org name for the email
  const [inviter, org] = await Promise.all([
    User.findById(invitedBy).select('firstName lastName'),
    Organization.findById(organizationId).select('churchName'),
  ]);

  const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}` : 'An admin';
  const churchName = org?.churchName || 'your organization';

  await sendInviteEmail(normalizedEmail, inviterName, churchName, token);

  res.status(201).json({
    message: 'Invitation sent successfully',
    invitation: {
      _id: invitation._id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    },
  });
};

export const getInvitations = async (req, res) => {
  const organizationId = req.user.organizationId;

  const invitations = await Invitation.find({ organizationId })
    .populate('invitedBy', 'firstName lastName email')
    .sort({ createdAt: -1 });

  res.json({ invitations });
};

export const revokeInvite = async (req, res) => {
  const { id } = req.params;
  const organizationId = req.user.organizationId;

  const invitation = await Invitation.findOne({ _id: id, organizationId });
  if (!invitation) {
    return res.status(404).json({ error: 'Invitation not found' });
  }

  if (invitation.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending invitations can be revoked' });
  }

  invitation.status = 'revoked';
  await invitation.save();

  res.json({ message: 'Invitation revoked' });
};

export const getInviteByToken = async (req, res) => {
  const { token } = req.params;

  const invitation = await Invitation.findOne({
    token,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  }).populate('organizationId', 'churchName');

  if (!invitation) {
    return res.status(404).json({ error: 'Invitation not found or has expired' });
  }

  res.json({
    invitation: {
      email: invitation.email,
      organizationName: invitation.organizationId?.churchName || 'your organization',
      expiresAt: invitation.expiresAt,
    },
  });
};

export const acceptInvite = async (req, res) => {
  const { token } = req.params;
  const { firstName, lastName, password } = req.body;

  if (!firstName || !lastName || !password) {
    return res.status(400).json({ error: 'First name, last name, and password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const invitation = await Invitation.findOne({
    token,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  });

  if (!invitation) {
    return res.status(404).json({ error: 'Invitation not found or has expired' });
  }

  const existingUser = await User.findOne({ email: invitation.email });
  if (existingUser) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await User.create({
    email: invitation.email,
    passwordHash,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    role: invitation.role,
    organizationId: invitation.organizationId,
    verified: true,
    status: 'active',
  });

  invitation.status = 'accepted';
  await invitation.save();

  const jwtToken = generateToken(
    user._id.toString(),
    user.role,
    user.organizationId.toString()
  );

  res.status(201).json({
    message: 'Account created successfully',
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
    },
    token: jwtToken,
  });
};
