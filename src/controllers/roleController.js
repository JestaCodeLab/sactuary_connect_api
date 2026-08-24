import Role from '../models/Role.js';
import User from '../models/User.js';
import { ALL_PERMISSION_KEYS, PERMISSION_MODULES } from '../config/permissions.js';

/**
 * Get the assignable permission taxonomy (for building the role-creation checklist UI)
 * GET /api/roles/permissions
 */
export const getPermissionTaxonomy = async (req, res) => {
  res.json({ modules: PERMISSION_MODULES });
};

/**
 * List all custom roles for the caller's organization
 * GET /api/roles
 */
export const getRoles = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const roles = await Role.find({ organizationId }).sort({ name: 1 });
    res.json({ roles });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
};

/**
 * Get a single custom role
 * GET /api/roles/:id
 */
export const getRoleById = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const role = await Role.findOne({ _id: req.params.id, organizationId });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }
    res.json({ role });
  } catch (error) {
    console.error('Error fetching role:', error);
    res.status(500).json({ error: 'Failed to fetch role' });
  }
};

/**
 * Create a custom role
 * POST /api/roles
 */
export const createRole = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, description, permissions = [] } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    const invalidKeys = permissions.filter(p => !ALL_PERMISSION_KEYS.includes(p));
    if (invalidKeys.length > 0) {
      return res.status(400).json({ error: `Invalid permission key(s): ${invalidKeys.join(', ')}` });
    }

    const existing = await Role.findOne({ organizationId, name: name.trim() });
    if (existing) {
      return res.status(409).json({ error: 'A role with this name already exists' });
    }

    const role = await Role.create({
      organizationId,
      name: name.trim(),
      description,
      permissions,
      createdBy: req.user.userId,
    });

    res.status(201).json({ message: 'Role created successfully', role });
  } catch (error) {
    console.error('Error creating role:', error);
    res.status(500).json({ error: 'Failed to create role' });
  }
};

/**
 * Update a custom role
 * PUT /api/roles/:id
 */
export const updateRole = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, description, permissions, isActive } = req.body;

    const role = await Role.findOne({ _id: req.params.id, organizationId });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (permissions) {
      const invalidKeys = permissions.filter(p => !ALL_PERMISSION_KEYS.includes(p));
      if (invalidKeys.length > 0) {
        return res.status(400).json({ error: `Invalid permission key(s): ${invalidKeys.join(', ')}` });
      }
      role.permissions = permissions;
    }

    if (name && name.trim()) {
      const duplicate = await Role.findOne({ organizationId, name: name.trim(), _id: { $ne: role._id } });
      if (duplicate) {
        return res.status(409).json({ error: 'A role with this name already exists' });
      }
      role.name = name.trim();
    }

    if (description !== undefined) role.description = description;
    if (isActive !== undefined) role.isActive = isActive;

    await role.save();
    res.json({ message: 'Role updated successfully', role });
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
};

/**
 * Deactivate (soft-delete) a custom role. Existing assignees keep their
 * current access frozen at whatever it was until reassigned - isActive:false
 * simply stops authorizeRoleOrPermission from granting anything new and
 * removes it from future invite/assignment dropdowns.
 * DELETE /api/roles/:id
 */
export const deactivateRole = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const role = await Role.findOne({ _id: req.params.id, organizationId });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    role.isActive = false;
    await role.save();

    const assigneeCount = await User.countDocuments({ organizationId, customRoleId: role._id });

    res.json({
      message: 'Role deactivated successfully',
      role,
      assigneeCount,
    });
  } catch (error) {
    console.error('Error deactivating role:', error);
    res.status(500).json({ error: 'Failed to deactivate role' });
  }
};

export default {
  getPermissionTaxonomy,
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  deactivateRole,
};
