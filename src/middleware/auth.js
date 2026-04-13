import { verifyToken } from '../config/jwt.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
};

export const authorizeRole = (allowedRoles) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // First check token role
    if (allowedRoles.includes(req.user.role)) {
      return next();
    }

    // If token doesn't have the role, check database (in case role was just updated)
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      if (allowedRoles.includes(user.role)) {
        // Update request context with current role
        req.user.role = user.role;
        req.user.organizationId = user.organizationId?.toString() || null;
        return next();
      }

      return res.status(403).json({ error: 'Forbidden - insufficient permissions' });
    } catch (error) {
      console.error('Authorization check error:', error);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
  };
};

/**
 * Verify that the requesting user owns the organization they're trying to access
 * Prevents cross-tenant access by validating org ownership
 * Should be used on any org-specific endpoints
 */
export const verifyOrgOwnership = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get organization ID from request (could be from params, body, or token)
    const orgId = req.params.id || req.params.organizationId || req.body.organizationId || req.user.organizationId;

    if (!orgId) {
      // If no org ID and user is admin, allow (they have their own org in token)
      if (req.user.role === 'admin') {
        return next();
      }
      return res.status(400).json({ error: 'Organization ID required' });
    }

    // Check if organization exists and user has access
    const organization = await Organization.findById(orgId);
    
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Verify ownership:
    // - Admin role: must be the org admin (adminId)
    // - Other roles: must have organizationId matching in token
    const isOrgAdmin = organization.adminId.toString() === req.user.userId;
    const tokenMatchesOrg = req.user.organizationId === orgId || req.user.organizationId === organization._id.toString();

    if (!isOrgAdmin && !tokenMatchesOrg) {
      return res.status(403).json({ 
        error: 'Forbidden - You do not have access to this organization',
        code: 'ORG_ACCESS_DENIED'
      });
    }

    // Attach organization to request for use in controller
    req.organization = organization;
    next();
  } catch (error) {
    console.error('Org ownership verification error:', error);
    res.status(500).json({ error: 'Failed to verify organization access' });
  }
};

/**
 * Gate a route to superadmin users only.
 * Must be used after authenticateToken.
 */
export const requireSuperadmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden - superadmin access required' });
  }
  next();
};

// Alias for backward compatibility
export const authenticate = authenticateToken;

export default {
  authenticateToken,
  authenticate,
  authorizeRole,
  verifyOrgOwnership,
};
