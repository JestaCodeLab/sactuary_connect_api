import crypto from 'crypto';
import Invitation from '../models/Invitation.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Role from '../models/Role.js';
import UserBranch from '../models/UserBranch.js';
import UserDepartment from '../models/UserDepartment.js';
import { generateToken } from '../config/jwt.js';
import { sendInviteEmail } from '../utils/email.js';
import bcrypt from 'bcryptjs';

const VALID_INVITE_ROLES = ['admin', 'pastor', 'staff', 'member', 'custom'];

export const sendInvite = async (req, res) => {
  const { email, role = 'admin', customRoleId, branchIds, departmentIds } = req.body;
  const organizationId = req.user.organizationId;
  const invitedBy = req.user.userId || req.user.id;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  if (!VALID_INVITE_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_INVITE_ROLES.join(', ')}` });
  }

  if (role === 'custom') {
    if (!customRoleId) {
      return res.status(400).json({ error: 'customRoleId is required when role is "custom"' });
    }
    const customRole = await Role.findOne({ _id: customRoleId, organizationId, isActive: true });
    if (!customRole) {
      return res.status(400).json({ error: 'Invalid or inactive custom role' });
    }
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
    role,
    customRoleId: role === 'custom' ? customRoleId : null,
    branchIds: Array.isArray(branchIds) ? branchIds : [],
    departmentIds: Array.isArray(departmentIds) ? departmentIds : [],
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
    customRoleId: invitation.customRoleId || null,
    organizationId: invitation.organizationId,
    verified: true,
    status: 'active',
  });

  if (invitation.branchIds?.length > 0) {
    await UserBranch.insertMany(
      invitation.branchIds.map(branchId => ({
        userId: user._id,
        branchId,
        organizationId: invitation.organizationId,
      }))
    );
  }

  if (invitation.departmentIds?.length > 0) {
    await UserDepartment.insertMany(
      invitation.departmentIds.map(departmentId => ({
        userId: user._id,
        departmentId,
        organizationId: invitation.organizationId,
      }))
    );
  }

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
