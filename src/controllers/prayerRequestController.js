import PrayerRequest from '../models/PrayerRequest.js';
import User from '../models/User.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';

export const getAllPrayerRequests = async (req, res) => {
  try {
    const requests = await PrayerRequest.find(branchFilter(req)).sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    console.error('Error fetching prayer requests:', error);
    res.status(500).json({ error: 'Failed to fetch prayer requests' });
  }
};

export const getPrayerRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await PrayerRequest.findById(id);

    if (!request) {
      return res.status(404).json({ error: 'Prayer request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Error fetching prayer request:', error);
    res.status(500).json({ error: 'Failed to fetch prayer request' });
  }
};

export const createPrayerRequest = async (req, res) => {
  try {
    const { title, description, category, isAnonymous } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    let authorName;
    if (!isAnonymous) {
      const user = await User.findById(req.user.userId).select('firstName lastName');
      if (user) {
        authorName = `${user.firstName} ${user.lastName.charAt(0)}.`;
      }
    }

    const request = await PrayerRequest.create({
      organizationId: req.organizationId,
      branchId,
      title,
      description,
      category: category || 'other',
      isAnonymous: isAnonymous || false,
      authorId: req.user.userId,
      authorName,
    });

    res.status(201).json(request);
  } catch (error) {
    console.error('Error creating prayer request:', error);
    res.status(500).json({ error: 'Failed to create prayer request' });
  }
};

export const prayForRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const request = await PrayerRequest.findById(id);
    if (!request) {
      return res.status(404).json({ error: 'Prayer request not found' });
    }

    if (request.prayedByUsers.map(u => u.toString()).includes(userId)) {
      return res.status(400).json({ error: 'You have already prayed for this request' });
    }

    request.prayedByUsers.push(userId);
    request.prayerCount += 1;
    request.updatedAt = Date.now();
    await request.save();

    res.json(request);
  } catch (error) {
    console.error('Error recording prayer:', error);
    res.status(500).json({ error: 'Failed to record prayer' });
  }
};

export const markAsAnswered = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await PrayerRequest.findByIdAndUpdate(
      id,
      { status: 'answered', updatedAt: Date.now() },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ error: 'Prayer request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Error marking as answered:', error);
    res.status(500).json({ error: 'Failed to update prayer request' });
  }
};

export const deletePrayerRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await PrayerRequest.findByIdAndDelete(id);

    if (!request) {
      return res.status(404).json({ error: 'Prayer request not found' });
    }

    res.json({ message: 'Prayer request deleted successfully' });
  } catch (error) {
    console.error('Error deleting prayer request:', error);
    res.status(500).json({ error: 'Failed to delete prayer request' });
  }
};

export default {
  getAllPrayerRequests,
  getPrayerRequestById,
  createPrayerRequest,
  prayForRequest,
  markAsAnswered,
  deletePrayerRequest,
};
