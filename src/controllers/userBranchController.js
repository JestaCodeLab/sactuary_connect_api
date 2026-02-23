import UserBranch from '../models/UserBranch.js';
import User from '../models/User.js';
import Branch from '../models/Branch.js';

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

    // Group assignments by userId
    const assignmentMap = {};
    assignments.forEach(a => {
      const uid = a.userId.toString();
      if (!assignmentMap[uid]) assignmentMap[uid] = [];
      if (a.branchId) {
        assignmentMap[uid].push(a.branchId);
      }
    });

    const usersWithBranches = users.map(u => ({
      ...u.toObject(),
      branches: assignmentMap[u._id.toString()] || [],
    }));

    res.json(usersWithBranches);
  } catch (error) {
    console.error('Error fetching org users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
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
};
