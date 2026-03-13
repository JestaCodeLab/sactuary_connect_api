import Organization from '../models/Organization.js';

/**
 * Get birthday settings for the organization
 */
export const getBirthdaySettings = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const organization = await Organization.findById(organizationId).select(
      'birthdayMessageTemplate birthdayAutoSendEnabled churchName'
    );

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    res.json({
      birthdayMessageTemplate: organization.birthdayMessageTemplate,
      birthdayAutoSendEnabled: organization.birthdayAutoSendEnabled,
      churchName: organization.churchName,
    });
  } catch (error) {
    console.error('Error fetching birthday settings:', error);
    res.status(500).json({ message: 'Failed to fetch birthday settings' });
  }
};

/**
 * Update birthday settings for the organization
 */
export const updateBirthdaySettings = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { birthdayMessageTemplate, birthdayAutoSendEnabled } = req.body;

    // Validate template contains valid variables
    const validVariables = ['{{firstName}}', '{{lastName}}', '{{age}}', '{{churchName}}'];
    
    if (birthdayMessageTemplate) {
      // Check if template is not empty
      if (!birthdayMessageTemplate.trim()) {
        return res.status(400).json({ 
          message: 'Birthday message template cannot be empty' 
        });
      }

      // Optional: Warn if no variables are used
      const hasVariables = validVariables.some(v => birthdayMessageTemplate.includes(v));
      if (!hasVariables) {
        console.warn('Birthday template does not use any template variables');
      }
    }

    const updateData = {};
    if (birthdayMessageTemplate !== undefined) {
      updateData.birthdayMessageTemplate = birthdayMessageTemplate;
    }
    if (birthdayAutoSendEnabled !== undefined) {
      updateData.birthdayAutoSendEnabled = birthdayAutoSendEnabled;
    }

    const organization = await Organization.findByIdAndUpdate(
      organizationId,
      updateData,
      { new: true, runValidators: true }
    ).select('birthdayMessageTemplate birthdayAutoSendEnabled churchName');

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    res.json({
      message: 'Birthday settings updated successfully',
      birthdayMessageTemplate: organization.birthdayMessageTemplate,
      birthdayAutoSendEnabled: organization.birthdayAutoSendEnabled,
    });
  } catch (error) {
    console.error('Error updating birthday settings:', error);
    res.status(500).json({ message: 'Failed to update birthday settings' });
  }
};

/**
 * Reset birthday message template to default
 */
export const resetBirthdayTemplate = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const defaultTemplate = "Happy Birthday {{firstName}}! 🎉🎂 May God bless you abundantly on your special day. You are loved and cherished. - {{churchName}}";

    const organization = await Organization.findByIdAndUpdate(
      organizationId,
      { birthdayMessageTemplate: defaultTemplate },
      { new: true, runValidators: true }
    ).select('birthdayMessageTemplate birthdayAutoSendEnabled churchName');

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    res.json({
      message: 'Birthday template reset to default',
      birthdayMessageTemplate: organization.birthdayMessageTemplate,
    });
  } catch (error) {
    console.error('Error resetting birthday template:', error);
    res.status(500).json({ message: 'Failed to reset birthday template' });
  }
};
