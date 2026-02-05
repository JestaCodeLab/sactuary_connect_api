import Organization from '../models/Organization.js';
import Branch from '../models/Branch.js';
import FundBucket from '../models/FundBucket.js';
import User from '../models/User.js';
import { generateToken } from '../config/jwt.js';

export const createOrganization = async (req, res) => {
  try {
    const { churchName, legalName, logoUrl, structure, currency, paymentGateway } = req.body;
    const adminId = req.user.userId;

    if (!churchName) {
      return res.status(400).json({ error: 'Church name is required' });
    }

    // Check if user already has an organization
    const existingOrg = await Organization.findOne({ adminId });
    if (existingOrg) {
      return res.status(400).json({ error: 'User already has an organization' });
    }

    const organization = await Organization.create({
      churchName,
      legalName,
      logoUrl,
      structure: structure || 'single',
      currency: currency || 'USD',
      paymentGateway,
      adminId,
    });

    // Promote user to admin role
    await User.findByIdAndUpdate(adminId, { role: 'admin' });

    // Generate new token with updated role
    const newToken = generateToken(adminId, 'admin');

    res.status(201).json({
      ...organization.toObject(),
      token: newToken,
    });
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({ error: 'Failed to create organization' });
  }
};

export const getOrganization = async (req, res) => {
  try {
    const { id } = req.params;
    const organization = await Organization.findById(id);

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json(organization);
  } catch (error) {
    console.error('Error fetching organization:', error);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
};

/**
 * Get the current user's organization
 * GET /api/organizations/me
 */
export const getMyOrganization = async (req, res) => {
  try {
    const userId = req.user.userId;
    const organization = await Organization.findOne({ adminId: userId });

    if (!organization) {
      return res.status(404).json({ error: 'No organization found for this user' });
    }

    // Also fetch branches and fund buckets for complete onboarding state
    const branches = await Branch.find({ organizationId: organization._id });
    const fundBuckets = await FundBucket.find({ organizationId: organization._id });

    res.json({
      organization,
      branches,
      fundBuckets,
    });
  } catch (error) {
    console.error('Error fetching user organization:', error);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
};

export const updateOrganization = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated
    delete updates.adminId;
    delete updates.id;

    const organization = await Organization.findByIdAndUpdate(id, updates, { new: true });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json(organization);
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
};

export const createBranch = async (req, res) => {
  try {
    const { organizationId, name, address, city, state, zipCode, latitude, longitude, radius, isHeadOffice } = req.body;

    if (!organizationId || !name) {
      return res.status(400).json({ error: 'Organization ID and branch name are required' });
    }

    const branch = await Branch.create({
      organizationId,
      name,
      address,
      city,
      state,
      zipCode,
      latitude,
      longitude,
      geofenceRadius: radius || 100,
      isHeadOffice: isHeadOffice || false,
    });

    res.status(201).json(branch);
  } catch (error) {
    console.error('Error creating branch:', error);
    res.status(500).json({ error: 'Failed to create branch' });
  }
};

export const getBranches = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const branches = await Branch.find({ organizationId });
    res.json(branches);
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
};

export const createFundBucket = async (req, res) => {
  try {
    const { organizationId, name, description, enabled } = req.body;

    if (!organizationId || !name) {
      return res.status(400).json({ error: 'Organization ID and bucket name are required' });
    }

    const fundBucket = await FundBucket.create({
      organizationId,
      name,
      description,
      enabled: enabled !== false,
    });

    res.status(201).json(fundBucket);
  } catch (error) {
    console.error('Error creating fund bucket:', error);
    res.status(500).json({ error: 'Failed to create fund bucket' });
  }
};

export const getFundBuckets = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const fundBuckets = await FundBucket.find({ organizationId }).sort({ createdAt: -1 });
    res.json(fundBuckets);
  } catch (error) {
    console.error('Error fetching fund buckets:', error);
    res.status(500).json({ error: 'Failed to fetch fund buckets' });
  }
};

export default {
  createOrganization,
  getOrganization,
  getMyOrganization,
  updateOrganization,
  createBranch,
  getBranches,
  createFundBucket,
  getFundBuckets,
};
