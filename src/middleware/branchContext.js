import UserBranch from '../models/UserBranch.js';

/**
 * Middleware to resolve branch context from X-Branch-Id header.
 * Must run AFTER authenticateToken.
 *
 * Sets on req:
 *   req.organizationId  - the user's organization (from JWT)
 *   req.branchId        - the selected branch ID (null if "all")
 *   req.allowedBranchIds - array of branch IDs user can access (null for admin = unrestricted)
 */
export const resolveBranchContext = async (req, res, next) => {
  try {
    const { userId, role, organizationId } = req.user;

    if (!organizationId) {
      // User not yet associated with an org (e.g., during onboarding)
      return next();
    }

    req.organizationId = organizationId;

    const headerBranchId = req.headers['x-branch-id'];

    if (role === 'admin') {
      // Admin can access all branches
      req.branchId = (headerBranchId && headerBranchId !== 'all')
        ? headerBranchId
        : null;
      req.allowedBranchIds = null; // null means unrestricted
    } else {
      // Non-admin: resolve assigned branches
      const assignments = await UserBranch.find({
        userId,
        organizationId,
      });
      const assignedBranchIds = assignments.map(a => a.branchId.toString());

      if (assignedBranchIds.length === 0) {
        return res.status(403).json({
          error: 'You are not assigned to any branch',
          code: 'NO_BRANCH_ASSIGNMENT',
        });
      }

      req.allowedBranchIds = assignedBranchIds;

      if (headerBranchId && headerBranchId !== 'all') {
        // Verify user has access to requested branch
        if (!assignedBranchIds.includes(headerBranchId)) {
          return res.status(403).json({
            error: 'You do not have access to this branch',
            code: 'BRANCH_ACCESS_DENIED',
          });
        }
        req.branchId = headerBranchId;
      } else if (assignedBranchIds.length === 1) {
        // Single branch assignment: auto-select
        req.branchId = assignedBranchIds[0];
      } else {
        // Multiple branches, no specific selection: use all assigned
        req.branchId = null;
      }
    }

    next();
  } catch (error) {
    console.error('Branch context error:', error);
    res.status(500).json({ error: 'Failed to resolve branch context' });
  }
};

export default { resolveBranchContext };
