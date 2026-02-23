import Message from '../models/Message.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';

export const getAllMessages = async (req, res) => {
  try {
    const messages = await Message.find(branchFilter(req)).sort({ createdAt: -1 });
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

export const getMessageById = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await Message.findById(id);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(message);
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
};

export const createMessage = async (req, res) => {
  try {
    const { subject, body, recipientType, recipientCount, channel, status, scheduledAt } = req.body;

    if (!subject || !body) {
      return res.status(400).json({ error: 'Subject and body are required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    const message = await Message.create({
      organizationId: req.organizationId,
      branchId,
      subject,
      body,
      recipientType,
      recipientCount: recipientCount || 0,
      channel,
      status: status || 'draft',
      scheduledAt,
      sentAt: status === 'sent' ? new Date() : undefined,
      authorId: req.user.userId,
    });

    res.status(201).json(message);
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
};

export const updateMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    delete updates._id;
    updates.updatedAt = Date.now();

    if (updates.status === 'sent' && !updates.sentAt) {
      updates.sentAt = new Date();
    }

    const message = await Message.findByIdAndUpdate(id, updates, { new: true });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(message);
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ error: 'Failed to update message' });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await Message.findByIdAndDelete(id);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
};

export default {
  getAllMessages,
  getMessageById,
  createMessage,
  updateMessage,
  deleteMessage,
};
