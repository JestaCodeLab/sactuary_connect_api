import UserDepartment from '../models/UserDepartment.js';

/**
 * Middleware to resolve department scope for custom-role users.
 * Must run AFTER authenticateToken.
 *
 * Unlike resolveBranchContext, this only restricts role === 'custom' users -
 * department scoping is brand new, so admin/pastor/staff/member (who could
 * already see all departments in their branch scope) must stay unaffected.
 *
 * Sets on req:
 *   req.allowedDepartmentIds - array of department IDs the user can access,
 *                              or null if unrestricted (every role except 'custom')
 */
export const resolveDepartmentContext = async (req, res, next) => {
  try {
    const { userId, role, organizationId } = req.user;

    if (role !== 'custom') {
      req.allowedDepartmentIds = null; // unrestricted - preserves existing behavior for every other role
      return next();
    }

    if (!organizationId) {
      req.allowedDepartmentIds = null;
      return next();
    }

    const assignments = await UserDepartment.find({ userId, organizationId });
    const assignedDepartmentIds = assignments.map(a => a.departmentId.toString());

    if (assignedDepartmentIds.length === 0) {
      return res.status(403).json({
        error: 'You are not assigned to any department',
        code: 'NO_DEPARTMENT_ASSIGNMENT',
      });
    }

    req.allowedDepartmentIds = assignedDepartmentIds;
    next();
  } catch (error) {
    console.error('Department context error:', error);
    res.status(500).json({ error: 'Failed to resolve department context' });
  }
};

export default { resolveDepartmentContext };
