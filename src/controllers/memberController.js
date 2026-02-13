import Member from '../models/Member.js';

export const getAllMembers = async (req, res) => {
  try {
    const members = await Member.find();
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
    } = req.body;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: 'First name, last name, and email are required' });
    }

    const member = await Member.create({
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

    res.json({ message: 'Member deleted successfully' });
  } catch (error) {
    console.error('Error deleting member:', error);
    res.status(500).json({ error: 'Failed to delete member' });
  }
};

export default {
  getAllMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
};
