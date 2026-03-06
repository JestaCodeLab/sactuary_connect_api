import mongoose from 'mongoose';

const toObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return id;
  }
};

/**
 * Build a MongoDB filter object that scopes queries by organization and branch.
 * Uses ObjectIds to ensure compatibility with both .find() and .aggregate() pipelines.
 *
 * @param {Object} req - Express request with branchContext resolved
 * @returns {Object} filter to spread into .find() or $match calls
 */
export function branchFilter(req) {
  const filter = {};

  if (req.organizationId) {
    filter.organizationId = toObjectId(req.organizationId);
  }

  if (req.branchId) {
    // Specific branch selected
    filter.branchId = toObjectId(req.branchId);
  } else if (req.allowedBranchIds) {
    // Non-admin with multiple assigned branches, no specific selection
    filter.branchId = { $in: req.allowedBranchIds.map(toObjectId) };
  }
  // If allowedBranchIds is null (admin with "all"), no branch filter = org-wide

  return filter;
}

/**
 * Resolve the target branchId for a create operation.
 * Uses the selected branch from context, or falls back to request body.
 *
 * @param {Object} req - Express request
 * @returns {string|null} branchId or null if none available
 */
export function resolveCreateBranch(req) {
  return req.branchId || req.body?.branchId || null;
}
