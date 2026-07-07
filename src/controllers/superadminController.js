import bcrypt from 'bcryptjs';
import { generateToken } from '../config/jwt.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import SmsCredit from '../models/SmsCredit.js';
import PlatformConfig from '../models/PlatformConfig.js';
import smsService from '../services/smsService.js';
import SmsPackage from '../models/SmsPackage.js';
import Member from '../models/Member.js';
import Branch from '../models/Branch.js';
import Department from '../models/Department.js';
import Event from '../models/Event.js';
import AuditLog from '../models/AuditLog.js';
import FinanceAccount from '../models/FinanceAccount.js';
import { verifyPaystackKey } from '../services/paystackService.js';
import { encrypt } from '../utils/encryption.js';
import { PLANS } from '../config/plans.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function log(actorId, action, { targetOrgId = null, targetUserId = null, details = {} } = {}) {
  await AuditLog.create({ actorId, action, targetOrgId, targetUserId, details });
}

// ─── Platform Stats ──────────────────────────────────────────────────────────

export const getStats = async (req, res) => {
  const [
    totalOrgs,
    activeOrgs,
    subscriptionAgg,
    totalMembers,
    totalSmsCredits,
  ] = await Promise.all([
    Organization.countDocuments(),
    Organization.countDocuments({ 'status': { $ne: 'suspended' } }),
    Subscription.aggregate([
      {
        $group: {
          _id: '$planId',
          count: { $sum: 1 },
          activeCount: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
          },
        },
      },
    ]),
    Member.countDocuments(),
    SmsCredit.aggregate([{ $group: { _id: null, total: { $sum: '$balance' } } }]),
  ]);

  const planBreakdown = {};
  for (const row of subscriptionAgg) {
    planBreakdown[row._id] = { total: row.count, active: row.activeCount };
  }

  const totalSms = totalSmsCredits[0]?.total ?? 0;

  res.json({
    totalOrgs,
    activeOrgs,
    suspendedOrgs: totalOrgs - activeOrgs,
    totalMembers,
    totalSmsCreditsInCirculation: totalSms,
    planBreakdown,
  });
};

// ─── Organizations ───────────────────────────────────────────────────────────

export const listOrganizations = async (req, res) => {
  const { page = 1, limit = 20, search, plan, status } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  // Build subscription filter first if plan requested
  let orgIdsFromPlan = null;
  if (plan) {
    const subs = await Subscription.find({ planId: plan }).select('organizationId');
    orgIdsFromPlan = subs.map((s) => s.organizationId);
  }

  const filter = {};
  if (search) {
    filter.$or = [
      { churchName: { $regex: search, $options: 'i' } },
      { legalName: { $regex: search, $options: 'i' } },
    ];
  }
  if (status === 'suspended') filter.status = 'suspended';
  if (orgIdsFromPlan) filter._id = { $in: orgIdsFromPlan };

  const [orgs, total] = await Promise.all([
    Organization.find(filter)
      .populate('adminId', 'firstName lastName email')
      .populate('subscriptionId', 'planId status currentPeriodEnd')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Organization.countDocuments(filter),
  ]);

  // Some orgs may not have subscriptionId set — do a fallback lookup by organizationId
  const missingSubOrgIds = orgs
    .filter((o) => !o.subscriptionId)
    .map((o) => o._id);

  if (missingSubOrgIds.length > 0) {
    const fallbackSubs = await Subscription.find({ organizationId: { $in: missingSubOrgIds } })
      .select('organizationId planId status currentPeriodEnd')
      .lean();
    const subByOrgId = {};
    for (const s of fallbackSubs) subByOrgId[s.organizationId.toString()] = s;
    for (const org of orgs) {
      if (!org.subscriptionId) {
        org.subscriptionId = subByOrgId[org._id.toString()] || null;
      }
    }
  }

  res.json({ orgs, total, page: Number(page), limit: Number(limit) });
};

export const getOrganization = async (req, res) => {
  const { id } = req.params;

  const org = await Organization.findById(id)
    .populate('adminId', 'firstName lastName email phone status')
    .populate('subscriptionId')
    .lean();

  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const [memberCount, branchCount, departmentCount, eventCount, smsCredit] = await Promise.all([
    Member.countDocuments({ organizationId: id }),
    Branch.countDocuments({ organizationId: id }),
    Department.countDocuments({ organizationId: id }),
    Event.countDocuments({ organizationId: id }),
    SmsCredit.findOne({ merchantId: id }).select('balance totalPurchased totalUsed').lean(),
  ]);

  // Fallback: resolve subscription if not populated via subscriptionId ref
  if (!org.subscriptionId) {
    org.subscriptionId = await Subscription.findOne({ organizationId: id }).lean();
  }

  res.json({ org, memberCount, branchCount, departmentCount, eventCount, smsCredit });
};

export const updateOrgStatus = async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'status must be active or suspended' });
  }

  const org = await Organization.findById(id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const previous = org.status;
  org.status = status;
  await org.save();

  await log(req.user.userId, status === 'suspended' ? 'suspend_org' : 'reactivate_org', {
    targetOrgId: id,
    details: { previous, reason },
  });

  res.json({ message: `Organization ${status}`, org });
};

export const createOrganization = async (req, res) => {
  const {
    churchName,
    legalName,
    adminEmail,
    adminPassword,
    adminFirstName,
    adminLastName,
    currency = 'GHS',
    organizationalStructure = 'single-branch',
    primaryLanguage = 'en',
  } = req.body;

  if (!churchName || !adminEmail || !adminPassword || !adminFirstName || !adminLastName) {
    return res.status(400).json({
      error: 'churchName, adminEmail, adminPassword, adminFirstName, and adminLastName are required',
    });
  }

  // Check if admin email already exists
  const existingUser = await User.findOne({ email: adminEmail.toLowerCase() });
  if (existingUser) {
    return res.status(409).json({ error: 'Admin email already in use' });
  }

  // Create admin user
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const admin = await User.create({
    email: adminEmail.toLowerCase(),
    passwordHash,
    firstName: adminFirstName,
    lastName: adminLastName,
    role: 'admin',
    verified: true,
    status: 'active',
  });

  // Create organization
  const org = await Organization.create({
    churchName,
    legalName: legalName || churchName,
    adminId: admin._id,
    currency,
    organizationalStructure,
    primaryLanguage,
    status: 'active',
  });

  // Link admin to organization
  admin.organizationId = org._id;
  await admin.save();

  // Create default branch if single-branch structure
  if (organizationalStructure === 'single-branch') {
    const branch = await Branch.create({
      organizationId: org._id,
      branchName: 'Main Branch',
      isDefault: true,
    });
    org.defaultBranchId = branch._id;
    await org.save();
  }

  // Initialize SMS credits
  await SmsCredit.getOrCreate(org._id);

  await log(req.user.userId, 'create_organization', {
    targetOrgId: org._id,
    details: { churchName, adminEmail },
  });

  res.status(201).json({
    message: 'Organization created',
    org,
    admin: { id: admin._id, email: admin.email, firstName: admin.firstName, lastName: admin.lastName },
  });
};

export const updateOrganization = async (req, res) => {
  const { id } = req.params;
  const {
    churchName,
    legalName,
    currency,
    organizationalStructure,
    primaryLanguage,
    timezone,
    logoUrl,
    phone,
    email,
    website,
    address,
    smsConfig,
  } = req.body;

  const org = await Organization.findById(id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const before = {
    churchName: org.churchName,
    legalName: org.legalName,
    currency: org.currency,
    smsConfig: org.smsConfig,
  };

  if (churchName != null) org.churchName = churchName;
  if (legalName != null) org.legalName = legalName;
  if (currency != null) org.currency = currency;
  if (organizationalStructure != null) org.organizationalStructure = organizationalStructure;
  if (primaryLanguage != null) org.primaryLanguage = primaryLanguage;
  if (timezone != null) org.timezone = timezone;
  if (logoUrl != null) org.logoUrl = logoUrl;
  if (phone != null) org.phone = phone;
  if (email != null) org.email = email;
  if (website != null) org.website = website;
  if (address != null) org.address = address;

  // Handle SMS Config updates (superadmin can update sender ID and status)
  if (smsConfig != null) {
    org.smsConfig = org.smsConfig || {};
    if (smsConfig.senderId != null) org.smsConfig.senderId = smsConfig.senderId;
    if (smsConfig.senderIdStatus != null) org.smsConfig.senderIdStatus = smsConfig.senderIdStatus;
    if (smsConfig.senderIdPurpose != null) org.smsConfig.senderIdPurpose = smsConfig.senderIdPurpose;
  }

  await org.save();

  await log(req.user.userId, 'update_organization', {
    targetOrgId: id,
    details: {
      before,
      after: {
        churchName: org.churchName,
        legalName: org.legalName,
        currency: org.currency,
        smsConfig: org.smsConfig,
      },
    },
  });

  res.json({ message: 'Organization updated', org });
};

export const deleteOrganization = async (req, res) => {
  const { id } = req.params;

  const org = await Organization.findById(id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  // Check for dependencies
  const [memberCount, branchCount, subscriptionCount] = await Promise.all([
    Member.countDocuments({ organizationId: id }),
    Branch.countDocuments({ organizationId: id }),
    Subscription.countDocuments({ organizationId: id }),
  ]);

  // Prevent deletion if there are dependencies (you can modify this logic)
  if (memberCount > 0 || branchCount > 0) {
    return res.status(400).json({
      error: 'Cannot delete organization with existing branches or members. Remove them first.',
      memberCount,
      branchCount,
    });
  }

  // Delete associated data
  await Promise.all([
    User.deleteMany({ organizationId: id }),
    Subscription.deleteMany({ organizationId: id }),
    SmsCredit.deleteMany({ merchantId: id }),
    Event.deleteMany({ organizationId: id }),
    Department.deleteMany({ organizationId: id }),
  ]);

  await Organization.findByIdAndDelete(id);

  await log(req.user.userId, 'delete_organization', {
    targetOrgId: id,
    details: { churchName: org.churchName },
  });

  res.json({ message: 'Organization deleted' });
};

// ─── Subscriptions ───────────────────────────────────────────────────────────

export const listSubscriptions = async (req, res) => {
  const { page = 1, limit = 20, plan, status } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter = {};
  if (plan) filter.planId = plan;
  if (status) filter.status = status;

  const [subs, total] = await Promise.all([
    Subscription.find(filter)
      .populate({ path: 'organizationId', select: 'churchName logoUrl' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Subscription.countDocuments(filter),
  ]);

  res.json({ subs, total, page: Number(page), limit: Number(limit) });
};

export const updateSubscription = async (req, res) => {
  const { orgId } = req.params;
  const { planId, status, currentPeriodEnd, billingCycle } = req.body;

  const validPlans = Object.keys(PLANS);
  const validStatuses = ['active', 'cancelled', 'past_due', 'trialing', 'paused'];

  if (planId && !validPlans.includes(planId)) {
    return res.status(400).json({ error: `Invalid planId. Must be one of: ${validPlans.join(', ')}` });
  }
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const sub = await Subscription.findOne({ organizationId: orgId });
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  const before = { planId: sub.planId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd };

  if (planId) sub.planId = planId;
  if (status) sub.status = status;
  if (currentPeriodEnd) sub.currentPeriodEnd = new Date(currentPeriodEnd);
  if (billingCycle) sub.billingCycle = billingCycle;

  await sub.save();

  await log(req.user.userId, 'update_subscription', {
    targetOrgId: orgId,
    details: { before, after: { planId: sub.planId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd } },
  });

  res.json({ message: 'Subscription updated', sub });
};

export const createSubscription = async (req, res) => {
  const { orgId, planId, status = 'active', billingCycle = 'monthly', currentPeriodEnd } = req.body;

  if (!orgId || !planId) {
    return res.status(400).json({ error: 'orgId and planId are required' });
  }
  const validPlans = Object.keys(PLANS);
  if (!validPlans.includes(planId)) {
    return res.status(400).json({ error: `Invalid planId. Must be one of: ${validPlans.join(', ')}` });
  }

  const org = await Organization.findById(orgId);
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const existing = await Subscription.findOne({ organizationId: orgId });
  if (existing) return res.status(409).json({ error: 'Subscription already exists for this organization. Use PATCH to update it.' });

  const periodEnd = currentPeriodEnd
    ? new Date(currentPeriodEnd)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days default

  const sub = await Subscription.create({
    organizationId: orgId,
    planId,
    status,
    billingCycle,
    currentPeriodStart: new Date(),
    currentPeriodEnd: periodEnd,
  });

  // Link subscription back to org
  org.subscriptionId = sub._id;
  await org.save();

  await log(req.user.userId, 'create_subscription', {
    targetOrgId: orgId,
    details: { planId, status, billingCycle, currentPeriodEnd: sub.currentPeriodEnd },
  });

  res.status(201).json({ message: 'Subscription created', sub });
};

export const deleteSubscription = async (req, res) => {
  const { id } = req.params;

  const sub = await Subscription.findById(id);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  const orgId = sub.organizationId;

  // Unlink from organization
  await Organization.findByIdAndUpdate(orgId, { $unset: { subscriptionId: 1 } });

  await Subscription.findByIdAndDelete(id);

  await log(req.user.userId, 'delete_subscription', {
    targetOrgId: orgId,
    details: { planId: sub.planId, status: sub.status },
  });

  res.json({ message: 'Subscription deleted' });
};

// ─── Branches ────────────────────────────────────────────────────────────────

export const listBranches = async (req, res) => {
  const { page = 1, limit = 20, search, orgId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter = {};
  if (search) {
    filter.name = { $regex: search, $options: 'i' };
  }
  if (orgId) {
    filter.organizationId = orgId;
  }

  const [branches, total] = await Promise.all([
    Branch.find(filter)
      .populate('organizationId', 'churchName logoUrl')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Branch.countDocuments(filter),
  ]);

  res.json({ branches, total, page: Number(page), limit: Number(limit) });
};

export const getBranch = async (req, res) => {
  const { id } = req.params;

  const branch = await Branch.findById(id)
    .populate('organizationId', 'churchName logoUrl')
    .lean();

  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  const [memberCount, departmentCount] = await Promise.all([
    Member.countDocuments({ branchId: id }),
    Department.countDocuments({ branchId: id }),
  ]);

  res.json({ branch, memberCount, departmentCount });
};

export const createBranch = async (req, res) => {
  const { orgId, name, location, isHeadquarters = false } = req.body;

  if (!orgId || !name) {
    return res.status(400).json({ error: 'orgId and name are required' });
  }

  const org = await Organization.findById(orgId);
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const branch = await Branch.create({
    organizationId: orgId,
    name,
    address: location,
    isHeadOffice: isHeadquarters,
  });

  await log(req.user.userId, 'create_branch', {
    targetOrgId: orgId,
    details: { branchName, branchId: branch._id },
  });

  res.status(201).json({ message: 'Branch created', branch });
};

export const updateBranch = async (req, res) => {
  const { id } = req.params;
  const { name, location, isHeadquarters } = req.body;

  const branch = await Branch.findById(id);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  const before = { name: branch.name };

  if (name != null) branch.name = name;
  if (location != null) branch.address = location;
  if (isHeadquarters != null) branch.isHeadOffice = isHeadquarters;

  await branch.save();

  await log(req.user.userId, 'update_branch', {
    targetOrgId: branch.organizationId,
    details: { branchId: id, before, after: { name: branch.name } },
  });

  res.json({ message: 'Branch updated', branch });
};

export const deleteBranch = async (req, res) => {
  const { id } = req.params;

  const branch = await Branch.findById(id);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  // Check for dependencies
  const [memberCount, departmentCount] = await Promise.all([
    Member.countDocuments({ branchId: id }),
    Department.countDocuments({ branchId: id }),
  ]);

  if (memberCount > 0 || departmentCount > 0) {
    return res.status(400).json({
      error: 'Cannot delete branch with existing members or departments. Remove them first.',
      memberCount,
      departmentCount,
    });
  }

  await Branch.findByIdAndDelete(id);

  await log(req.user.userId, 'delete_branch', {
    targetOrgId: branch.organizationId,
    details: { name: branch.name, branchId: id },
  });

  res.json({ message: 'Branch deleted' });
};

// ─── Departments ─────────────────────────────────────────────────────────────

export const listDepartments = async (req, res) => {
  const { page = 1, limit = 20, search, orgId, branchId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter = {};
  if (search) {
    filter.name = { $regex: search, $options: 'i' };
  }
  if (orgId) {
    filter.organizationId = orgId;
  }
  if (branchId) {
    filter.branchId = branchId;
  }

  const [departments, total] = await Promise.all([
    Department.find(filter)
      .populate('organizationId', 'churchName')
      .populate('branchId', 'name')
      .populate('leaderId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Department.countDocuments(filter),
  ]);

  res.json({ departments, total, page: Number(page), limit: Number(limit) });
};

export const getDepartment = async (req, res) => {
  const { id } = req.params;

  const department = await Department.findById(id)
    .populate('organizationId', 'churchName')
    .populate('branchId', 'branchName')
    .populate('leaderId', 'firstName lastName email phone')
    .lean();

  if (!department) return res.status(404).json({ error: 'Department not found' });

  const memberCount = await Member.countDocuments({ departmentId: id });

  res.json({ department, memberCount });
};

export const createDepartment = async (req, res) => {
  const { orgId, branchId, name, description, leaderId } = req.body;

  if (!orgId || !branchId || !name) {
    return res.status(400).json({ error: 'orgId, branchId, and name are required' });
  }

  const [org, branch] = await Promise.all([
    Organization.findById(orgId),
    Branch.findById(branchId),
  ]);

  if (!org) return res.status(404).json({ error: 'Organization not found' });
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  const department = await Department.create({
    organizationId: orgId,
    branchId,
    name,
    description,
    leaderId,
  });

  await log(req.user.userId, 'create_department', {
    targetOrgId: orgId,
    details: { name, departmentId: department._id },
  });

  res.status(201).json({ message: 'Department created', department });
};

export const updateDepartment = async (req, res) => {
  const { id } = req.params;
  const { name, description, leaderId } = req.body;

  const department = await Department.findById(id);
  if (!department) return res.status(404).json({ error: 'Department not found' });

  const before = { name: department.name };

  if (name != null) department.name = name;
  if (description != null) department.description = description;
  if (leaderId !== undefined) department.leaderId = leaderId || null;

  await department.save();

  await log(req.user.userId, 'update_department', {
    targetOrgId: department.organizationId,
    details: { departmentId: id, before, after: { name: department.name } },
  });

  res.json({ message: 'Department updated', department });
};

export const deleteDepartment = async (req, res) => {
  const { id } = req.params;

  const department = await Department.findById(id);
  if (!department) return res.status(404).json({ error: 'Department not found' });

  const memberCount = await Member.countDocuments({ departmentId: id });

  if (memberCount > 0) {
    return res.status(400).json({
      error: 'Cannot delete department with existing members. Remove them first or reassign them.',
      memberCount,
    });
  }

  await Department.findByIdAndDelete(id);

  await log(req.user.userId, 'delete_department', {
    targetOrgId: department.organizationId,
    details: { name: department.name, departmentId: id },
  });

  res.json({ message: 'Department deleted' });
};

// ─── Members ─────────────────────────────────────────────────────────────────

export const listMembers = async (req, res) => {
  const { page = 1, limit = 20, search, orgId, branchId, departmentId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter = {};
  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }
  if (orgId) {
    filter.organizationId = orgId;
  }
  if (branchId) {
    filter.branchId = branchId;
  }
  if (departmentId) {
    filter.departmentId = departmentId;
  }

  const [members, total] = await Promise.all([
    Member.find(filter)
      .populate('organizationId', 'churchName')
      .populate('branchId', 'name')
      .populate('departments', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Member.countDocuments(filter),
  ]);

  res.json({ members, total, page: Number(page), limit: Number(limit) });
};

export const getMember = async (req, res) => {
  const { id } = req.params;

  const member = await Member.findById(id)
    .populate('organizationId', 'churchName')
    .populate('branchId', 'branchName')
    .populate('departmentId', 'departmentName')
    .lean();

  if (!member) return res.status(404).json({ error: 'Member not found' });

  res.json({ member });
};

export const updateMember = async (req, res) => {
  const { id } = req.params;
  const {
    firstName,
    lastName,
    email,
    phone,
    dateOfBirth,
    gender,
    maritalStatus,
    address,
    branchId,
    departmentId,
    membershipStatus,
  } = req.body;

  const member = await Member.findById(id);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const before = {
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email,
  };

  if (firstName != null) member.firstName = firstName;
  if (lastName != null) member.lastName = lastName;
  if (email != null) member.email = email;
  if (phone != null) member.phone = phone;
  if (dateOfBirth != null) member.dateOfBirth = dateOfBirth;
  if (gender != null) member.gender = gender;
  if (maritalStatus != null) member.maritalStatus = maritalStatus;
  if (address != null) member.address = address;
  if (branchId != null) member.branchId = branchId;
  if (departmentId !== undefined) member.departmentId = departmentId || null;
  if (membershipStatus != null) member.membershipStatus = membershipStatus;

  await member.save();

  await log(req.user.userId, 'update_member', {
    targetOrgId: member.organizationId,
    details: {
      memberId: id,
      before,
      after: { firstName: member.firstName, lastName: member.lastName, email: member.email },
    },
  });

  res.json({ message: 'Member updated', member });
};

export const deleteMember = async (req, res) => {
  const { id } = req.params;

  const member = await Member.findById(id);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  await Member.findByIdAndDelete(id);

  await log(req.user.userId, 'delete_member', {
    targetOrgId: member.organizationId,
    details: { memberId: id, name: `${member.firstName} ${member.lastName}` },
  });

  res.json({ message: 'Member deleted' });
};

// ─── SMS Credits ─────────────────────────────────────────────────────────────

export const listSmsCredits = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [credits, total] = await Promise.all([
    SmsCredit.find()
      .populate({ path: 'merchantId', select: 'churchName logoUrl' })
      .sort({ balance: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    SmsCredit.countDocuments(),
  ]);

  res.json({ credits, total, page: Number(page), limit: Number(limit) });
};

export const adjustSmsCredits = async (req, res) => {
  const { orgId } = req.params;
  const { amount, type = 'bonus', description = 'Superadmin adjustment' } = req.body;

  if (!amount || typeof amount !== 'number') {
    return res.status(400).json({ error: 'amount must be a number' });
  }

  const validTypes = ['bonus', 'purchase', 'refund', 'usage'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }

  const credit = await SmsCredit.getOrCreate(orgId);
  const before = credit.balance;

  if (type === 'usage') {
    await credit.deductCredits(Math.abs(amount), description, `superadmin-${req.user.userId}`);
  } else {
    await credit.addCredits(Math.abs(amount), type, description, `superadmin-${req.user.userId}`);
  }

  await log(req.user.userId, 'adjust_sms_credits', {
    targetOrgId: orgId,
    details: { before, after: credit.balance, delta: amount, type, description },
  });

  res.json({ message: 'SMS credits updated', balance: credit.balance });
};

// Get stored BMS platform balance (last synced from a send response)
export const getBmsPlatformBalance = async (req, res) => {
  try {
    const stored = await PlatformConfig.get('bms_balance');
    res.json({
      balance: stored?.balance ?? null,
      updatedAt: stored?.updatedAt ?? null,
      hasData: stored !== null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Send a test SMS to SUPERADMIN_PHONE, capture credit_left, persist it
export const checkBmsBalance = async (req, res) => {
  const phone = process.env.SUPERADMIN_PHONE;
  if (!phone) return res.status(500).json({ error: 'SUPERADMIN_PHONE not set in .env' });

  try {
    const result = await smsService.sendSingleFree({
      phone,
      message: 'Welcome to Sanctuary Connect.',
      category: 'general',
      metadata: { isBmsBalanceCheck: true },
    });

    const stored = await PlatformConfig.get('bms_balance');

    res.json({
      success: result.success,
      balance: stored?.balance ?? null,
      updatedAt: stored?.updatedAt ?? null,
      smsSent: result.success,
      campaignId: result.campaignId,
    });
  } catch (error) {
    const status = error.response?.status;
    const detail = error.response?.data?.message || error.response?.data?.error || error.message;
    res.status(500).json({ error: detail || error.message });
  }
};

// ─── Audit Log ───────────────────────────────────────────────────────────────

export const getAuditLog = async (req, res) => {
  const { page = 1, limit = 50, orgId, action } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter = {};
  if (orgId) filter.targetOrgId = orgId;
  if (action) filter.action = action;

  const [entries, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('actorId', 'firstName lastName email')
      .populate('targetOrgId', 'churchName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  res.json({ entries, total, page: Number(page), limit: Number(limit) });
};

// ─── SMS Packages ────────────────────────────────────────────────────────────

export const listSmsPackages = async (req, res) => {
  const packages = await SmsPackage.find().sort({ credits: 1 }).lean();
  res.json({ packages });
};

export const createSmsPackage = async (req, res) => {
  const { name, credits, price, currency = 'GHS', isActive = true } = req.body;
  if (!name || !credits || price == null) {
    return res.status(400).json({ error: 'name, credits, and price are required' });
  }
  const pkg = await SmsPackage.create({ name, credits: Number(credits), price: Number(price), currency, isActive });
  await log(req.user.userId, 'create_sms_package', { details: { name, credits, price } });
  res.status(201).json({ message: 'SMS package created', package: pkg });
};

export const updateSmsPackage = async (req, res) => {
  const { id } = req.params;
  const { name, credits, price, currency, isActive } = req.body;
  const pkg = await SmsPackage.findById(id);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });

  const before = { name: pkg.name, credits: pkg.credits, price: pkg.price };
  if (name != null) pkg.name = name;
  if (credits != null) pkg.credits = Number(credits);
  if (price != null) pkg.price = Number(price);
  if (currency != null) pkg.currency = currency;
  if (isActive != null) pkg.isActive = isActive;
  await pkg.save();

  await log(req.user.userId, 'update_sms_package', { details: { before, after: { name: pkg.name, credits: pkg.credits, price: pkg.price } } });
  res.json({ message: 'SMS package updated', package: pkg });
};

export const deleteSmsPackage = async (req, res) => {
  const { id } = req.params;
  const pkg = await SmsPackage.findByIdAndDelete(id);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });
  await log(req.user.userId, 'delete_sms_package', { details: { name: pkg.name } });
  res.json({ message: 'SMS package deleted' });
};

// ─── Finance Account Approval ─────────────────────────────────────────────────

export const listPendingFinanceAccounts = async (req, res) => {
  try {
    const { status = 'pending', page = 1, limit = 20, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = {};
    if (status) filter.status = status;

    if (search) {
      filter.$or = [
        { businessName: { $regex: search, $options: 'i' } },
        { ownerFullName: { $regex: search, $options: 'i' } },
        { ownerEmail: { $regex: search, $options: 'i' } },
      ];
    }

    const [accounts, total] = await Promise.all([
      FinanceAccount.find(filter)
        .populate('organizationId', 'churchName')
        .populate('submittedBy', 'firstName lastName email')
        .populate('approvedBy', 'firstName lastName email')
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      FinanceAccount.countDocuments(filter),
    ]);

    res.json({
      accounts,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    console.error('Error listing finance accounts:', error);
    res.status(500).json({ error: 'Failed to list finance accounts' });
  }
};

export const getFinanceAccountDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const account = await FinanceAccount.findById(id)
      .populate('organizationId', 'churchName legalName')
      .populate('submittedBy', 'firstName lastName email')
      .populate('approvedBy', 'firstName lastName email')
      .populate('revokedBy', 'firstName lastName email')
      .populate('statusHistory.changedBy', 'firstName lastName email')
      .lean();

    if (!account) {
      return res.status(404).json({ error: 'Finance account not found' });
    }

    res.json(account);
  } catch (error) {
    console.error('Error fetching finance account details:', error);
    res.status(500).json({ error: 'Failed to fetch finance account details' });
  }
};

export const approveFinanceAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, paystackSecretKey, paystackPublicKey } = req.body;

    const account = await FinanceAccount.findById(id);
    if (!account) {
      return res.status(404).json({ error: 'Finance account not found' });
    }

    if (account.status !== 'pending') {
      return res.status(400).json({
        error: `Cannot approve account with status: ${account.status}`,
      });
    }

    // Optionally set Paystack keys in the same step ("added when approving")
    if (paystackSecretKey || paystackPublicKey) {
      if (!paystackSecretKey || !paystackPublicKey) {
        return res.status(400).json({ error: 'Both paystackSecretKey and paystackPublicKey are required to set keys' });
      }
      const verification = await verifyPaystackKey(paystackSecretKey);
      if (!verification.valid) {
        return res.status(400).json({ error: verification.error || 'Invalid Paystack secret key' });
      }
      account.paystackSecretKey = encrypt(paystackSecretKey);
      account.paystackPublicKey = paystackPublicKey;
      account.paystackKeysAddedAt = Date.now();
      account.paystackKeysAddedBy = req.user._id;
    }

    // Update account status
    account.status = 'approved';
    account.approvedAt = Date.now();
    account.approvedBy = req.user._id;
    account.statusHistory.push({
      status: 'approved',
      changedBy: req.user._id,
      notes: notes || 'Approved by superadmin',
    });

    await account.save();

    // Update Organization's financeAccountId reference
    await Organization.findByIdAndUpdate(account.organizationId, {
      financeAccountId: account._id,
    });

    // Log to audit trail
    await log(req.user._id, 'approve_finance_account', {
      targetOrgId: account.organizationId,
      details: {
        financeAccountId: account._id,
        businessName: account.businessName,
        notes,
      },
    });

    res.json({
      message: 'Finance account approved successfully',
      account: {
        _id: account._id,
        status: account.status,
        approvedAt: account.approvedAt,
      },
    });
  } catch (error) {
    console.error('Error approving finance account:', error);
    res.status(500).json({ error: 'Failed to approve finance account' });
  }
};

export const rejectFinanceAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason, rejectionDetails } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({ error: 'rejectionReason is required' });
    }

    const account = await FinanceAccount.findById(id);
    if (!account) {
      return res.status(404).json({ error: 'Finance account not found' });
    }

    if (account.status !== 'pending') {
      return res.status(400).json({
        error: `Cannot reject account with status: ${account.status}`,
      });
    }

    // Update account status
    account.status = 'rejected';
    account.rejectionReason = rejectionReason;
    account.rejectionDetails = rejectionDetails || '';
    account.statusHistory.push({
      status: 'rejected',
      changedBy: req.user._id,
      notes: rejectionReason,
    });

    await account.save();

    // Log to audit trail
    await log(req.user._id, 'reject_finance_account', {
      targetOrgId: account.organizationId,
      details: {
        financeAccountId: account._id,
        businessName: account.businessName,
        rejectionReason,
      },
    });

    // TODO: Send email notification to organization admin with rejection reason

    res.json({
      message: 'Finance account rejected. Organization can resubmit.',
      account: {
        _id: account._id,
        status: account.status,
        rejectionReason: account.rejectionReason,
      },
    });
  } catch (error) {
    console.error('Error rejecting finance account:', error);
    res.status(500).json({ error: 'Failed to reject finance account' });
  }
};

export const revokeFinanceAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { revokedReason } = req.body;

    if (!revokedReason) {
      return res.status(400).json({ error: 'revokedReason is required' });
    }

    const account = await FinanceAccount.findById(id);
    if (!account) {
      return res.status(404).json({ error: 'Finance account not found' });
    }

    if (account.status !== 'approved') {
      return res.status(400).json({
        error: `Can only revoke approved accounts. Current status: ${account.status}`,
      });
    }

    // Update account status
    account.status = 'revoked';
    account.revokedAt = Date.now();
    account.revokedBy = req.user._id;
    account.revokedReason = revokedReason;
    account.statusHistory.push({
      status: 'revoked',
      changedBy: req.user._id,
      notes: revokedReason,
    });

    await account.save();

    // Remove financeAccountId from organization if it matches
    await Organization.findByIdAndUpdate(account.organizationId, {
      financeAccountId: null,
    });

    // Log to audit trail
    await log(req.user._id, 'revoke_finance_account', {
      targetOrgId: account.organizationId,
      details: {
        financeAccountId: account._id,
        businessName: account.businessName,
        revokedReason,
      },
    });

    // TODO: Send email notification to organization admin about revocation

    res.json({
      message: 'Finance account revoked successfully',
      account: {
        _id: account._id,
        status: account.status,
        revokedAt: account.revokedAt,
      },
    });
  } catch (error) {
    console.error('Error revoking finance account:', error);
    res.status(500).json({ error: 'Failed to revoke finance account' });
  }
};

export const setFinanceAccountPaystackKeys = async (req, res) => {
  try {
    const { id } = req.params;
    const { paystackSecretKey, paystackPublicKey } = req.body;

    if (!paystackSecretKey || !paystackPublicKey) {
      return res.status(400).json({ error: 'paystackSecretKey and paystackPublicKey are required' });
    }

    const account = await FinanceAccount.findById(id);
    if (!account) {
      return res.status(404).json({ error: 'Finance account not found' });
    }

    if (account.tier !== 'primary') {
      return res.status(400).json({ error: 'Paystack keys can only be set on the primary finance account' });
    }

    if (account.status !== 'approved') {
      return res.status(400).json({
        error: `Can only set Paystack keys for approved accounts. Current status: ${account.status}`,
      });
    }

    const verification = await verifyPaystackKey(paystackSecretKey);
    if (!verification.valid) {
      return res.status(400).json({ error: verification.error || 'Invalid Paystack secret key' });
    }

    account.paystackSecretKey = encrypt(paystackSecretKey);
    account.paystackPublicKey = paystackPublicKey;
    account.paystackKeysAddedAt = Date.now();
    account.paystackKeysAddedBy = req.user._id;
    account.statusHistory.push({
      status: 'approved',
      changedBy: req.user._id,
      notes: 'Paystack keys configured',
    });
    await account.save();

    await log(req.user._id, 'set_finance_account_paystack_keys', {
      targetOrgId: account.organizationId,
      details: { financeAccountId: account._id },
    });

    res.json({
      message: 'Paystack keys saved successfully.',
      account: {
        _id: account._id,
        paystackKeysAddedAt: account.paystackKeysAddedAt,
      },
    });
  } catch (error) {
    console.error('Error setting Paystack keys:', error);
    res.status(500).json({ error: 'Failed to set Paystack keys' });
  }
};

export const getOrgFinanceAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const account = await FinanceAccount.findOne({ organizationId: id })
      .populate('submittedBy', 'firstName lastName email')
      .populate('approvedBy', 'firstName lastName')
      .populate('statusHistory.changedBy', 'firstName lastName');

    if (!account) return res.json({ status: 'not_started' });
    res.json(account);
  } catch (error) {
    console.error('Error fetching org finance account:', error);
    res.status(500).json({ error: 'Failed to fetch finance account' });
  }
};

// ─── Create Superadmin ────────────────────────────────────────────────────────

export const createSuperadmin = async (req, res) => {
  const { email, password, firstName, lastName } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'email, password, firstName and lastName are required' });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    email: email.toLowerCase(),
    passwordHash,
    firstName,
    lastName,
    role: 'superadmin',
    verified: true,
    status: 'active',
  });

  await log(req.user.userId, 'create_superadmin', {
    targetUserId: user._id,
    details: { email: user.email },
  });

  res.status(201).json({
    message: 'Superadmin created',
    user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName },
  });
};
