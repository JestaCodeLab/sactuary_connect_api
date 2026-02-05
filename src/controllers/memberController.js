import Member from '../models/Member.js';
import User from '../models/User.js';

export const getAllMembers = async (req, res) => {
  try {
    const members = await Member.find().populate('userId', 'email firstName lastName phone');
    res.json(members);
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
};

export const getMemberById = async (req, res) => {
  try {
    const { id } = req.params;
    const member = await Member.findById(id).populate('userId', 'email firstName lastName phone');

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
      userId, dateOfBirth, gender, maritalStatus, 
      address, city, state, zipCode, country,
      baptismDate, membershipDate
    } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const member = await Member.create({
      userId,
      dateOfBirth,
      gender,
      maritalStatus,
      address,
      city,
      state,
      zipCode,
      country,
      baptismDate,
      membershipDate,
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
    const updates = req.body;

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates.userId;

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
