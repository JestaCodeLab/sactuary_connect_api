import Organization from '../models/Organization.js';
import Branch from '../models/Branch.js';
import FinanceAccount from '../models/FinanceAccount.js';
import OfferingType from '../models/OfferingType.js';
import FundBucket from '../models/FundBucket.js';
import Donation from '../models/Donation.js';
import Transaction from '../models/Transaction.js';
import { decrypt } from '../utils/encryption.js';
import { initializeTransaction, verifyTransaction } from '../services/paystackService.js';

const DONATION_TYPES = ['tithe', 'offering', 'project'];

// GET /api/public/giving/:organizationId/info?branchId=
export const getGivingInfo = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { branchId } = req.query;

    const org = await Organization.findById(organizationId).lean();
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const branches = await Branch.find({ organizationId }).sort({ isHeadOffice: -1, name: 1 }).lean();
    const approvedAccounts = await FinanceAccount.find({ organizationId, status: 'approved' }).lean();
    const approvedBranchIds = new Set(approvedAccounts.map((a) => String(a.branchId)));

    const branchList = branches.map((b) => ({
      _id: b._id,
      name: b.name,
      givingEnabled: approvedBranchIds.has(String(b._id)),
    }));

    const targetBranchId = branchId || (branches.find((b) => b.isHeadOffice) || branches[0])?._id;
    const givingEnabled = targetBranchId ? approvedBranchIds.has(String(targetBranchId)) : false;

    let offeringTypes = [];
    let projects = [];

    if (givingEnabled) {
      offeringTypes = await OfferingType.find({ organizationId, branchId: targetBranchId, enabled: true }).sort({ createdAt: 1 }).lean();
      if (offeringTypes.length === 0) {
        const defaultType = await OfferingType.create({
          organizationId,
          branchId: targetBranchId,
          name: 'General',
          isDefault: true,
        });
        offeringTypes = [defaultType.toObject()];
      }

      const projectFilter = {
        organizationId,
        status: { $ne: 'archived' },
        $or: [{ branchId: targetBranchId }, { branchId: null }],
      };
      const projectDocs = await FundBucket.find(projectFilter).sort({ createdAt: -1 }).lean();
      const projectIds = projectDocs.map((p) => p._id);

      const raised = await Donation.aggregate([
        { $match: { fundBucketId: { $in: projectIds }, donationType: 'project' } },
        { $group: { _id: '$fundBucketId', raisedAmount: { $sum: '$amount' } } },
      ]);
      const raisedById = new Map(raised.map((r) => [String(r._id), r.raisedAmount]));

      projects = projectDocs.map((p) => ({
        ...p,
        raisedAmount: raisedById.get(String(p._id)) || 0,
      }));
    }

    res.json({
      churchName: org.churchName,
      currency: org.currency || 'GHS',
      branches: branchList,
      selectedBranchId: targetBranchId || null,
      givingEnabled,
      offeringTypes,
      projects,
    });
  } catch (error) {
    console.error('Error fetching giving info:', error);
    res.status(500).json({ error: 'Failed to fetch giving info' });
  }
};

// POST /api/public/giving/initialize
export const initializeGivingPayment = async (req, res) => {
  try {
    const { organizationId, branchId, donationType, offeringTypeId, fundBucketId, amount, email, donorName, donorPhone } = req.body;

    if (!organizationId || !branchId || !donationType || !amount || !email) {
      return res.status(400).json({ error: 'organizationId, branchId, donationType, amount, and email are required' });
    }
    if (!DONATION_TYPES.includes(donationType)) {
      return res.status(400).json({ error: `donationType must be one of: ${DONATION_TYPES.join(', ')}` });
    }
    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const org = await Organization.findById(organizationId).lean();
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const primary = await FinanceAccount.findOne({ organizationId, tier: 'primary', status: 'approved' });
    if (!primary || !primary.paystackSecretKey) {
      return res.status(400).json({ error: 'This church is not yet set up to receive online payments' });
    }

    const targetAccount = await FinanceAccount.findOne({ organizationId, branchId, status: 'approved' });
    if (!targetAccount) {
      return res.status(400).json({ error: 'This branch is not yet set up to receive payments' });
    }

    const secretKey = decrypt(primary.paystackSecretKey);
    const reference = `give_${organizationId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const subaccount = targetAccount.tier === 'subaccount' ? targetAccount.paystackSubaccountCode : undefined;

    const result = await initializeTransaction({
      email,
      amount: Math.round(amount * 100),
      currency: org.currency || 'GHS',
      reference,
      metadata: { organizationId, branchId, donationType, offeringTypeId, fundBucketId, donorName, donorPhone },
      subaccount,
    }, secretKey);

    res.json({ authorization_url: result.authorization_url, reference: result.reference });
  } catch (error) {
    console.error('Error initializing giving payment:', error);
    res.status(500).json({ error: error.message || 'Failed to initialize payment' });
  }
};

// GET /api/public/giving/verify/:reference?organizationId=
export const verifyGivingPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const { organizationId } = req.query;

    if (!organizationId) {
      return res.status(400).json({ error: 'organizationId is required' });
    }

    // Idempotent: if we've already recorded this payment, return it as-is
    const existingTransaction = await Transaction.findOne({ providerReference: reference });
    if (existingTransaction) {
      const donation = await Donation.findById(existingTransaction.relatedId);
      return res.json({ success: true, donation });
    }

    const primary = await FinanceAccount.findOne({ organizationId, tier: 'primary', status: 'approved' });
    if (!primary || !primary.paystackSecretKey) {
      return res.status(400).json({ error: 'This church is not yet set up to receive online payments' });
    }

    const secretKey = decrypt(primary.paystackSecretKey);
    const verification = await verifyTransaction(reference, secretKey);

    if (!verification.verified) {
      return res.status(400).json({ success: false, message: verification.message || 'Payment verification failed' });
    }

    const { amount, currency, channel, metadata, customer } = verification.data;
    const { branchId, donationType, offeringTypeId, fundBucketId, donorName, donorPhone } = metadata || {};

    const donation = await Donation.create({
      organizationId,
      branchId,
      amount: amount / 100,
      donationType,
      donationDate: new Date(),
      paymentMethod: 'online',
      transactionId: reference,
      donorName,
      donorEmail: customer?.email,
      donorPhone,
      offeringTypeId: donationType === 'offering' ? offeringTypeId : undefined,
      fundBucketId: donationType === 'project' ? fundBucketId : undefined,
    });

    await Transaction.create({
      organizationId,
      branchId,
      type: 'donation',
      direction: 'inflow',
      amount: amount / 100,
      currency,
      status: 'completed',
      paymentMethod: 'online',
      paymentProvider: 'paystack',
      providerReference: reference,
      channel,
      relatedModel: 'Donation',
      relatedId: donation._id,
      description: `${donationType || 'General'} donation (online)`,
      metadata: { donorName, donorEmail: customer?.email, offeringTypeId, fundBucketId },
    });

    res.json({ success: true, donation });
  } catch (error) {
    console.error('Error verifying giving payment:', error);
    res.status(500).json({ error: error.message || 'Failed to verify payment' });
  }
};

export default { getGivingInfo, initializeGivingPayment, verifyGivingPayment };
