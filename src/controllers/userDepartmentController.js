import UserDepartment from '../models/UserDepartment.js';
import User from '../models/User.js';

/**
 * GET /api/users/me/departments
 * Get the current user's assigned departments
 */
export const getMyDepartments = async (req, res) => {
  try {
    const { userId, organizationId } = req.user;

    if (!organizationId) {
      return res.json([]);
    }

    const assignments = await UserDepartment.find({ userId, organizationId })
      .populate('departmentId');

    const departments = assignments
      .map(a => a.departmentId)
      .filter(Boolean);

    res.json(departments);
  } catch (error) {
    console.error('Error fetching user departments:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
};

/**
 * POST /api/organizations/:orgId/users/:userId/departments
 * Assign a user to departments { departmentIds: [...] }
 * Replaces all existing assignments
 */
export const assignDepartments = async (req, res) => {
  try {
    const { orgId, userId } = req.params;
    const { departmentIds } = req.body;

    if (!departmentIds || !Array.isArray(departmentIds)) {
      return res.status(400).json({ error: 'departmentIds array is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await UserDepartment.deleteMany({ userId, organizationId: orgId });

    if (departmentIds.length > 0) {
      const assignments = departmentIds.map(departmentId => ({
        userId,
        departmentId,
        organizationId: orgId,
      }));
      await UserDepartment.insertMany(assignments);
    }

    const updated = await UserDepartment.find({ userId, organizationId: orgId })
      .populate('departmentId', 'name');

    const departments = updated.map(a => a.departmentId).filter(Boolean);

    res.json({ departments });
  } catch (error) {
    console.error('Error assigning departments:', error);
    res.status(500).json({ error: 'Failed to assign departments' });
  }
};

/**
 * DELETE /api/organizations/:orgId/users/:userId/departments/:departmentId
 */
export const removeDepartment = async (req, res) => {
  try {
    const { orgId, userId, departmentId } = req.params;

    const result = await UserDepartment.findOneAndDelete({
      userId,
      departmentId,
      organizationId: orgId,
    });

    if (!result) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ message: 'Department assignment removed' });
  } catch (error) {
    console.error('Error removing department assignment:', error);
    res.status(500).json({ error: 'Failed to remove assignment' });
  }
};

export default {
  getMyDepartments,
  assignDepartments,
  removeDepartment,
};
