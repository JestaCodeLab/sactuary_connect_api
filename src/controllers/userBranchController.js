import UserBranch from '../models/UserBranch.js';
import UserDepartment from '../models/UserDepartment.js';
import User from '../models/User.js';
import Branch from '../models/Branch.js';
import Organization from '../models/Organization.js';
import Role from '../models/Role.js';

/**
 * GET /api/users/me/branches
 * Get the current user's assigned branches
 */
export const getMyBranches = async (req, res) => {
  try {
    const { userId, role, organizationId } = req.user;

    if (!organizationId) {
      return res.json([]);
    }

    if (role === 'admin') {
      // Admin sees all org branches
      const branches = await Branch.find({ organizationId });
      return res.json(branches);
    }

    const assignments = await UserBranch.find({ userId, organizationId })
      .populate('branchId');

    const branches = assignments
      .map(a => a.branchId)
      .filter(Boolean);

    res.json(branches);
  } catch (error) {
    console.error('Error fetching user branches:', error);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
};

/**
 * GET /api/organizations/:orgId/users
 * List all users in the organization with their branch assignments
 */
export const getOrgUsers = async (req, res) => {
  try {
    const { orgId } = req.params;

    const users = await User.find({ organizationId: orgId })
      .select('-passwordHash')
      .sort({ createdAt: -1 });

    // Get all branch assignments for these users
    const userIds = users.map(u => u._id);
    const assignments = await UserBranch.find({
      userId: { $in: userIds },
      organizationId: orgId,
    }).populate('branchId', 'name');

    // Group branch assignments by userId
    const branchMap = {};
    assignments.forEach(a => {
      const uid = a.userId.toString();
      if (!branchMap[uid]) branchMap[uid] = [];
      if (a.branchId) {
        branchMap[uid].push(a.branchId);
      }
    });

    // Group department assignments by userId
    const deptAssignments = await UserDepartment.find({
      userId: { $in: userIds },
      organizationId: orgId,
    }).populate('departmentId', 'name');
    const departmentMap = {};
    deptAssignments.forEach(a => {
      const uid = a.userId.toString();
      if (!departmentMap[uid]) departmentMap[uid] = [];
      if (a.departmentId) {
        departmentMap[uid].push(a.departmentId);
      }
    });

    // Resolve custom role names
    const customRoleIds = users.map(u => u.customRoleId).filter(Boolean);
    const customRoles = customRoleIds.length > 0
      ? await Role.find({ _id: { $in: customRoleIds } }).select('name isActive')
      : [];
    const roleMap = Object.fromEntries(customRoles.map(r => [r._id.toString(), r]));

    const usersWithBranches = users.map(u => ({
      ...u.toObject(),
      branches: branchMap[u._id.toString()] || [],
      departments: departmentMap[u._id.toString()] || [],
      customRole: u.customRoleId ? roleMap[u.customRoleId.toString()] || null : null,
    }));

    res.json(usersWithBranches);
  } catch (error) {
    console.error('Error fetching org users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

/**
 * PATCH /api/organizations/:orgId/users/:userId/role
 * Reassign an existing team member's role (and optionally their branch/
 * department scope in the same step). Admin only.
 */
export const updateUserRole = async (req, res) => {
  try {
    const { orgId, userId } = req.params;
    const { role, customRoleId, branchIds, departmentIds } = req.body;

    const VALID_ROLES = ['admin', 'pastor', 'staff', 'member', 'custom'];
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    if (userId === req.user.userId) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    const organization = await Organization.findById(orgId);
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    if (organization.adminId.toString() === userId) {
      return res.status(400).json({ error: "The organization owner's role can't be changed here" });
    }

    const user = await User.findOne({ _id: userId, organizationId: orgId });
    if (!user) {
      return res.status(404).json({ error: 'User not found in this organization' });
    }

    if (role === 'custom') {
      if (!customRoleId) {
        return res.status(400).json({ error: 'customRoleId is required when role is "custom"' });
      }
      const customRole = await Role.findOne({ _id: customRoleId, organizationId: orgId, isActive: true });
      if (!customRole) {
        return res.status(400).json({ error: 'Invalid or inactive custom role' });
      }
      user.customRoleId = customRoleId;
    } else {
      user.customRoleId = null;
    }

    user.role = role;
    await user.save();

    if (Array.isArray(branchIds)) {
      await UserBranch.deleteMany({ userId, organizationId: orgId });
      if (branchIds.length > 0) {
        await UserBranch.insertMany(branchIds.map(branchId => ({ userId, branchId, organizationId: orgId })));
      }
    }

    if (Array.isArray(departmentIds)) {
      await UserDepartment.deleteMany({ userId, organizationId: orgId });
      if (departmentIds.length > 0) {
        await UserDepartment.insertMany(departmentIds.map(departmentId => ({ userId, departmentId, organizationId: orgId })));
      }
    }

    res.json({ message: 'Role updated successfully', user: { ...user.toObject(), passwordHash: undefined } });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
};

/**
 * POST /api/organizations/:orgId/users/:userId/branches
 * Assign a user to branches { branchIds: [...] }
 * Replaces all existing assignments
 */
export const assignBranches = async (req, res) => {
  try {
    const { orgId, userId } = req.params;
    const { branchIds } = req.body;

    if (!branchIds || !Array.isArray(branchIds)) {
      return res.status(400).json({ error: 'branchIds array is required' });
    }

    // Verify user belongs to this org
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Set user's organizationId if not already set
    if (!user.organizationId) {
      user.organizationId = orgId;
      await user.save();
    }

    // Remove all existing assignments
    await UserBranch.deleteMany({ userId, organizationId: orgId });

    // Create new assignments
    if (branchIds.length > 0) {
      const assignments = branchIds.map(branchId => ({
        userId,
        branchId,
        organizationId: orgId,
      }));
      await UserBranch.insertMany(assignments);
    }

    // Return updated assignments
    const updated = await UserBranch.find({ userId, organizationId: orgId })
      .populate('branchId', 'name');

    const branches = updated.map(a => a.branchId).filter(Boolean);

    res.json({ branches });
  } catch (error) {
    console.error('Error assigning branches:', error);
    res.status(500).json({ error: 'Failed to assign branches' });
  }
};

/**
 * DELETE /api/organizations/:orgId/users/:userId/branches/:branchId
 * Remove a single branch assignment
 */
export const removeBranch = async (req, res) => {
  try {
    const { orgId, userId, branchId } = req.params;

    const result = await UserBranch.findOneAndDelete({
      userId,
      branchId,
      organizationId: orgId,
    });

    if (!result) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ message: 'Branch assignment removed' });
  } catch (error) {
    console.error('Error removing branch assignment:', error);
    res.status(500).json({ error: 'Failed to remove assignment' });
  }
};

export default {
  getMyBranches,
  getOrgUsers,
  assignBranches,
  removeBranch,
  updateUserRole,
};
