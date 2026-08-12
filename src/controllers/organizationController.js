import Organization from '../models/Organization.js';
import Branch from '../models/Branch.js';
import FundBucket from '../models/FundBucket.js';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import { generateToken } from '../config/jwt.js';
import { checkBranchLimit } from '../utils/usageLimits.js';
import { PLANS } from '../config/plans.js';

export const createOrganization = async (req, res) => {
  try {
    const { churchName, legalName, logoUrl, structure, currency, paymentGateway } = req.body;
    const adminId = req.user.userId;

    console.log('🔵 [ORG CREATE] Starting org creation for user:', adminId);

    if (!churchName) {
      return res.status(400).json({ error: 'Church name is required' });
    }

    // Fetch current user state to verify they don't already have an org
    const user = await User.findById(adminId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('🔵 [ORG CREATE] User state - organizationId:', user.organizationId, 'role:', user.role);

    // Check if user already has an organization (double-check to prevent race conditions)
    if (user.organizationId) {
      console.log('🟠 [ORG CREATE] User already has organizationId:', user.organizationId);
      // User already has org - return it so frontend can resume
      const existingOrg = await Organization.findById(user.organizationId);
      return res.status(400).json({ 
        error: 'User already has an organization',
        code: 'ORG_ALREADY_EXISTS',
        existingOrganization: existingOrg ? {
          id: existingOrg._id,
          churchName: existingOrg.churchName,
          onboardingStep: existingOrg.onboardingStep,
        } : null
      });
    }

    // Also verify no org exists with this user as admin (backup check)
    const existingOrg = await Organization.findOne({ adminId });
    if (existingOrg) {
      console.log('🟠 [ORG CREATE] Organization exists with this adminId:', existingOrg._id);
      return res.status(400).json({ 
        error: 'User already has an organization',
        code: 'ORG_ALREADY_EXISTS',
        existingOrganization: {
          id: existingOrg._id,
          churchName: existingOrg.churchName,
          onboardingStep: existingOrg.onboardingStep,
        }
      });
    }

    console.log('🟢 [ORG CREATE] No existing org found, creating new org:', { churchName });

    // Create the organization - always default to 'multi' structure, plan determines limits
    const organization = await Organization.create({
      churchName,
      legalName,
      logoUrl,
      structure: 'multi',
      currency: currency || 'USD',
      paymentGateway: paymentGateway || 'paystack',
      adminId,
    });

    console.log('🟢 [ORG CREATE] Organization created:', organization._id);

    // Atomically promote user to admin role and set organizationId
    // Using findByIdAndUpdate with new: true to get updated user
    const updatedUser = await User.findByIdAndUpdate(
      adminId, 
      { 
        role: 'admin', 
        organizationId: organization._id 
      },
      { new: true }
    );

    if (!updatedUser) {
      // Rollback: delete organization if user update fails
      console.log('🟠 [ORG CREATE] User update failed, rolling back org creation');
      await Organization.findByIdAndDelete(organization._id);
      return res.status(500).json({ error: 'Failed to promote user role' });
    }

    console.log('🟢 [ORG CREATE] User promoted to admin, organizationId set');

    // Create default seed subscription for new organization
    const seedPlan = PLANS['seed'];
    const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    const subscription = await Subscription.create({
      organizationId: organization._id,
      planId: 'seed',
      status: 'active',
      billingCycle: 'monthly',
      currentPeriodStart: new Date(),
      currentPeriodEnd: currentPeriodEnd,
      paymentMethod: 'manual',
    });

    console.log('🟢 [ORG CREATE] Default seed subscription created:', subscription._id);

    // Generate new token with updated role and organizationId
    const newToken = generateToken(
      updatedUser._id.toString(), 
      updatedUser.role, 
      organization._id.toString()
    );

    res.status(201).json({
      message: 'Organization created successfully',
      _id: organization._id.toString(),
      churchName: organization.churchName,
      legalName: organization.legalName,
      logoUrl: organization.logoUrl,
      structure: organization.structure,
      currency: organization.currency,
      paymentGateway: organization.paymentGateway,
      onboardingStep: organization.onboardingStep,
      adminId: organization.adminId.toString(),
      createdAt: organization.createdAt,
      organization: organization.toObject(),
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        role: updatedUser.role,
        organizationId: organization._id.toString(),
      },
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
    const { userId, organizationId } = req.user;

    let organization;
    if (organizationId) {
      organization = await Organization.findById(organizationId);
    } else {
      // Fallback for admin users without organizationId in token
      organization = await Organization.findOne({ adminId: userId });
    }

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

    // Debug logging for onboarding completion
    if (updates.onboardingComplete !== undefined) {
      console.log(`[DEBUG] Organization ${id}: Marking onboarding complete = ${updates.onboardingComplete}`);
    }

    const organization = await Organization.findByIdAndUpdate(id, updates, { new: true });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Verify the update was saved
    if (updates.onboardingComplete !== undefined) {
      console.log(`[DEBUG] Organization ${id}: Verified onboardingComplete = ${organization.onboardingComplete}`);
    }

    res.json(organization);
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
};

export const createBranch = async (req, res) => {
  try {
    const { name, address, city, suburb, region, zipCode, latitude, longitude, radius, isHeadOffice } = req.body;
    // verifyOrgOwnership has already confirmed the caller owns this org - use it,
    // not whatever organizationId the client sent in the body.
    const organizationId = req.organization._id;

    if (!name) {
      return res.status(400).json({ error: 'Branch name is required' });
    }

    console.log('🔵 [BRANCH CREATE] Creating branch with data:', {
      organizationId,
      name,
      city,
      latitude,
      longitude,
      radius,
      isHeadOffice,
    });

    // Check branch limit
    const limitCheck = await checkBranchLimit(organizationId);
    console.log('📊 [BRANCH CREATE] Limit check result:', limitCheck);
    
    if (!limitCheck.allowed) {
      console.log('❌ [BRANCH CREATE] Branch limit rejected:', { reason: limitCheck.reason, ...limitCheck });
      return res.status(403).json({
        error: `Branch limit reached. Current: ${limitCheck.current}/${limitCheck.limit}`,
        code: 'BRANCH_LIMIT_EXCEEDED',
        current: limitCheck.current,
        limit: limitCheck.limit,
      });
    }

    const branch = await Branch.create({
      organizationId,
      name,
      address,
      city,
      suburb,
      region,
      zipCode,
      latitude,
      longitude,
      geofenceRadius: radius || 100,
      isHeadOffice: isHeadOffice || false,
    });

    console.log('🟢 [BRANCH CREATE] Branch created successfully:', {
      id: branch._id,
      name: branch.name,
      latitude: branch.latitude,
      longitude: branch.longitude,
      geofenceRadius: branch.geofenceRadius,
    });

    res.status(201).json(branch);
  } catch (error) {
    console.error('❌ Error creating branch:', error);
    res.status(500).json({ error: 'Failed to create branch' });
  }
};

export const getBranches = async (req, res) => {
  try {
    // verifyOrgOwnership has already confirmed the caller owns this org.
    const branches = await Branch.find({ organizationId: req.organization._id });
    res.json(branches);
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
};

export const updateBranch = async (req, res) => {
  try {
    const { branchId } = req.params;
    const { name, address, city, suburb, region, zipCode, latitude, longitude, radius, isHeadOffice } = req.body;

    const branch = await Branch.findById(branchId);
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    // verifyOrgOwnership only confirmed the :organizationId in the URL belongs to the
    // caller - it says nothing about whether this specific branch does. Check that too.
    if (branch.organizationId.toString() !== req.organization._id.toString()) {
      return res.status(403).json({ error: 'Forbidden - This branch does not belong to your organization' });
    }

    if (name !== undefined) branch.name = name;
    if (address !== undefined) branch.address = address;
    if (city !== undefined) branch.city = city;
    if (suburb !== undefined) branch.suburb = suburb;
    if (region !== undefined) branch.region = region;
    if (zipCode !== undefined) branch.zipCode = zipCode;
    if (latitude !== undefined) branch.latitude = latitude;
    if (longitude !== undefined) branch.longitude = longitude;
    if (radius !== undefined) branch.geofenceRadius = radius;
    if (isHeadOffice !== undefined) branch.isHeadOffice = isHeadOffice;
    branch.updatedAt = Date.now();

    await branch.save();
    res.json(branch);
  } catch (error) {
    console.error('Error updating branch:', error);
    res.status(500).json({ error: 'Failed to update branch' });
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
  updateBranch,
  createFundBucket,
  getFundBuckets,
};
