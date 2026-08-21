import SmsTemplate from '../models/SmsTemplate.js';
import logger from '../utils/logger.js';

// Get all templates for organization
export const getTemplates = async (req, res) => {
  try {
    const { organizationId } = req.user;

    const templates = await SmsTemplate.find({
      organizationId,
      isActive: true,
    })
      .select('_id name message description category variables usageCount createdAt')
      .sort({ createdAt: -1 });

    res.json(templates);
  } catch (error) {
    logger.error(`Get templates error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
};

// Get single template
export const getTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user;

    const template = await SmsTemplate.findOne({
      _id: id,
      organizationId,
      isActive: true,
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(template);
  } catch (error) {
    logger.error(`Get template error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
};

// Create template
export const createTemplate = async (req, res) => {
  try {
    const { organizationId, userId } = req.user;
    const { name, message, description, category } = req.body;

    // Validation
    if (!organizationId) {
      return res.status(401).json({ error: 'Organization ID not found in token' });
    }

    if (!name || !message) {
      return res.status(400).json({ error: 'Name and message are required' });
    }

    if (message.length > 160) {
      return res.status(400).json({ error: 'Message cannot exceed 160 characters' });
    }

    // Extract variables from message ({{variableName}})
    const variableMatches = message.match(/{{([^}]+)}}/g) || [];
    const variables = [...new Set(variableMatches.map(v => v.replace(/{{|}}/g, '')))];

    const template = new SmsTemplate({
      organizationId,
      name,
      message,
      description,
      category: category || 'general',
      variables,
      createdBy: userId,
    });

    await template.save();

    logger.info(`📝 SMS template created: ${template._id} by user ${userId} in org ${organizationId}`);

    res.status(201).json(template);
  } catch (error) {
    logger.error(`Create template error: ${error.message}`);
    res.status(500).json({ error: error.message || 'Failed to create template' });
  }
};

// Update template
export const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user;
    const { name, message, description, category } = req.body;

    const template = await SmsTemplate.findOne({
      _id: id,
      organizationId,
      isActive: true,
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Validation
    if (message && message.length > 160) {
      return res.status(400).json({ error: 'Message cannot exceed 160 characters' });
    }

    // Update fields
    if (name) template.name = name;
    if (message) {
      template.message = message;
      // Re-extract variables
      const variableMatches = message.match(/{{([^}]+)}}/g) || [];
      template.variables = [...new Set(variableMatches.map(v => v.replace(/{{|}}/g, '')))];
    }
    if (description !== undefined) template.description = description;
    if (category) template.category = category;

    await template.save();

    logger.info(`📝 SMS template updated: ${template._id}`);

    res.json(template);
  } catch (error) {
    logger.error(`Update template error: ${error.message}`);
    res.status(500).json({ error: 'Failed to update template' });
  }
};

// Delete template
export const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user;

    const template = await SmsTemplate.findOne({
      _id: id,
      organizationId,
      isActive: true,
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Soft delete
    template.isActive = false;
    await template.save();

    logger.info(`🗑️ SMS template deleted: ${template._id}`);

    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    logger.error(`Delete template error: ${error.message}`);
    res.status(500).json({ error: 'Failed to delete template' });
  }
};

// Duplicate template
export const duplicateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId, userId } = req.user;

    const original = await SmsTemplate.findOne({
      _id: id,
      organizationId,
      isActive: true,
    });

    if (!original) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const duplicate = new SmsTemplate({
      organizationId,
      name: `${original.name} (Copy)`,
      message: original.message,
      description: original.description,
      category: original.category,
      variables: original.variables,
      createdBy: userId,
    });

    await duplicate.save();

    logger.info(`📋 SMS template duplicated: ${original._id} -> ${duplicate._id}`);

    res.status(201).json(duplicate);
  } catch (error) {
    logger.error(`Duplicate template error: ${error.message}`);
    res.status(500).json({ error: 'Failed to duplicate template' });
  }
};
