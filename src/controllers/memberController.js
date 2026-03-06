import Member from '../models/Member.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';

// Validate family members exist and belong to the same organization
const validateFamilyMembers = async (familyMembers, organizationId, currentMemberId) => {
  if (!familyMembers || familyMembers.length === 0) {
    return true;
  }

  if (!Array.isArray(familyMembers)) {
    throw new Error('familyMembers must be an array');
  }

  // Validate structure and relationships
  const memberIds = new Set();
  for (const familyMember of familyMembers) {
    if (!familyMember.memberId || !familyMember.relationship) {
      throw new Error('Each family member must have memberId and relationship');
    }

    if (memberIds.has(familyMember.memberId)) {
      throw new Error('Duplicate family member IDs');
    }
    memberIds.add(familyMember.memberId);

    if (familyMember.memberId === currentMemberId) {
      throw new Error('Cannot add member as their own family member');
    }
  }

  // Validate all members exist and belong to same organization
  const members = await Member.find({
    _id: { $in: Array.from(memberIds) },
    organizationId,
  });

  if (members.length !== memberIds.size) {
    throw new Error('One or more family members not found or belong to a different organization');
  }

  return true;
};

export const getAllMembers = async (req, res) => {
  try {
    const members = await Member.find(branchFilter(req));
    res.json(members);
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
};

export const getMemberById = async (req, res) => {
  try {
    const { id } = req.params;
    const member = await Member.findById(id);

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json(member);
  } catch (error) {
    console.error('Error fetching member:', error);
    res.status(500).json({ error: 'Failed to fetch member' });
  }
};

export const createMember = async (req, res) => {
  try {
    const {
      firstName, lastName, email, phone,
      dateOfBirth, gender, maritalStatus,
      address, city, suburb, region, zipCode, country,
      baptismDate, membershipDate, memberStatus,
      familyMembers, notes,
    } = req.body;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: 'First name, last name, and email are required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    // Validate family members before creating
    if (familyMembers && familyMembers.length > 0) {
      try {
        await validateFamilyMembers(familyMembers, req.organizationId, null);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }
    }

    const member = await Member.create({
      organizationId: req.organizationId,
      branchId,
      firstName,
      lastName,
      email,
      phone,
      dateOfBirth,
      gender,
      maritalStatus,
      address,
      city,
      suburb,
      region,
      zipCode,
      country,
      baptismDate,
      membershipDate,
      memberStatus: memberStatus || 'active',
      familyMembers,
      notes,
    });

    res.status(201).json(member);
  } catch (error) {
    console.error('Error creating member:', error);
    res.status(500).json({ error: 'Failed to create member' });
  }
};

export const updateMember = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates._id;
    delete updates.userId;
    delete updates.organizationId;
    delete updates.branchId;

    // Validate family members if being updated
    if (updates.familyMembers) {
      try {
        await validateFamilyMembers(updates.familyMembers, req.organizationId, id);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }
    }

    updates.updatedAt = Date.now();

    const member = await Member.findByIdAndUpdate(id, updates, { new: true });

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json(member);
  } catch (error) {
    console.error('Error updating member:', error);
    res.status(500).json({ error: 'Failed to update member' });
  }
};

export const deleteMember = async (req, res) => {
  try {
    const { id } = req.params;
    const member = await Member.findByIdAndDelete(id);

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Remove this member from all other members' familyMembers arrays
    await Member.updateMany(
      { familyMembers: id },
      { $pull: { familyMembers: id } }
    );

    res.json({ message: 'Member deleted successfully' });
  } catch (error) {
    console.error('Error deleting member:', error);
    res.status(500).json({ error: 'Failed to delete member' });
  }
};

export const getUpcomingBirthdays = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const now = new Date();
    const currentDayOfYear = Math.floor(
      (now - new Date(now.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24)
    );

    // Find members with dateOfBirth set, then filter by upcoming birthdays
    const members = await Member.find({
      ...branchFilter(req),
      dateOfBirth: { $ne: null },
    });

    const today = [];
    const upcoming = [];

    members.forEach((member) => {
      const dob = new Date(member.dateOfBirth);
      // Create a birthday date in the current year
      const birthdayThisYear = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());

      // If birthday already passed this year, check next year
      let nextBirthday = birthdayThisYear;
      if (birthdayThisYear < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        nextBirthday = new Date(now.getFullYear() + 1, dob.getMonth(), dob.getDate());
      }

      const diffTime = nextBirthday.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        const age = now.getFullYear() - dob.getFullYear();
        today.push({ ...member.toObject(), age, daysUntilBirthday: 0 });
      } else if (diffDays > 0 && diffDays <= days) {
        const age = nextBirthday.getFullYear() - dob.getFullYear();
        upcoming.push({ ...member.toObject(), age, daysUntilBirthday: diffDays });
      }
    });

    // Sort upcoming by nearest birthday
    upcoming.sort((a, b) => a.daysUntilBirthday - b.daysUntilBirthday);

    res.json({ today, upcoming });
  } catch (error) {
    console.error('Error fetching upcoming birthdays:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming birthdays' });
  }
};

export default {
  getAllMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  getUpcomingBirthdays,
};
