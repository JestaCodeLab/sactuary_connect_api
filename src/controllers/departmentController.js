import Department from '../models/Department.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';
import { checkDepartmentLimit } from '../utils/usageLimits.js';

export const getAllDepartments = async (req, res) => {
  try {
    const departments = await Department.find(branchFilter(req))
      .populate('branchId', 'name')
      .populate('leaderId', 'firstName lastName email')
      .populate('members', 'firstName lastName email phone memberStatus')
      .sort({ name: 1 });

    res.json(departments);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
};

export const getDepartmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const department = await Department.findById(id)
      .populate('branchId', 'name')
      .populate('leaderId', 'firstName lastName email')
      .populate('members', 'firstName lastName email phone memberStatus');

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    res.json(department);
  } catch (error) {
    console.error('Error fetching department:', error);
    res.status(500).json({ error: 'Failed to fetch department' });
  }
};

export const createDepartment = async (req, res) => {
  try {
    const { organizationId, branchId, name, description, leaderId, tags } = req.body;

    if (!name || !branchId) {
      return res.status(400).json({ error: 'Department name and branch are required' });
    }

    const cleanTags = Array.isArray(tags)
      ? [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 5)
      : [];

    // Check department limit
    const limitCheck = await checkDepartmentLimit(req.organizationId);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: 'Department limit reached for your plan',
        code: 'DEPARTMENT_LIMIT_EXCEEDED',
        current: limitCheck.current,
        limit: limitCheck.limit,
      });
    }

    const department = await Department.create({
      organizationId: req.organizationId,
      branchId,
      name,
      description,
      leaderId: leaderId && leaderId.trim() ? leaderId : null,
      tags: cleanTags,
    });

    const populated = await Department.findById(department._id)
      .populate('branchId', 'name')
      .populate('leaderId', 'firstName lastName email');

    res.status(201).json(populated);
  } catch (error) {
    console.error('Error creating department:', error);
    res.status(500).json({ error: 'Failed to create department', details: error.message });
  }
};

export const updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updatedAt: Date.now() };
    delete updates._id;
    delete updates.organizationId;
    delete updates.members;

    if (updates.tags !== undefined) {
      updates.tags = Array.isArray(updates.tags)
        ? [...new Set(updates.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 5)
        : [];
    }

    const department = await Department.findByIdAndUpdate(id, updates, { new: true })
      .populate('branchId', 'name')
      .populate('leaderId', 'firstName lastName email')
      .populate('members', 'firstName lastName email phone memberStatus');

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    res.json(department);
  } catch (error) {
    console.error('Error updating department:', error);
    res.status(500).json({ error: 'Failed to update department' });
  }
};

export const deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const department = await Department.findByIdAndDelete(id);

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Error deleting department:', error);
    res.status(500).json({ error: 'Failed to delete department' });
  }
};

export const addMemberToDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const { memberId } = req.body;

    if (!memberId) {
      return res.status(400).json({ error: 'Member ID is required' });
    }

    const department = await Department.findById(id);
    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    if (department.members.includes(memberId)) {
      return res.status(400).json({ error: 'Member is already in this department' });
    }

    department.members.push(memberId);
    department.updatedAt = new Date();
    await department.save();

    const populated = await Department.findById(id)
      .populate('branchId', 'name')
      .populate('leaderId', 'firstName lastName email')
      .populate('members', 'firstName lastName email phone memberStatus');

    res.json(populated);
  } catch (error) {
    console.error('Error adding member to department:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
};

export const removeMemberFromDepartment = async (req, res) => {
  try {
    const { id, memberId } = req.params;

    const department = await Department.findById(id);
    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    department.members = department.members.filter(
      (m) => m.toString() !== memberId
    );
    department.updatedAt = new Date();
    await department.save();

    const populated = await Department.findById(id)
      .populate('branchId', 'name')
      .populate('leaderId', 'firstName lastName email')
      .populate('members', 'firstName lastName email phone memberStatus');

    res.json(populated);
  } catch (error) {
    console.error('Error removing member from department:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
};

export default {
  getAllDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  addMemberToDepartment,
  removeMemberFromDepartment,
};
